import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'

// Execute com Bun: os modulos reais do consumidor usam TypeScript e #shared/*.
if (!process.versions.bun || !process.argv[2]) {
  throw new Error('uso: bun scripts/diagnosticar-hicode.mjs <hicode>')
}
const hii = dirname(dirname(fileURLToPath(import.meta.url)))
const hicode = resolve(process.argv[2])
const cwd = process.cwd()
const env = { ...process.env }
const carregar = (raiz, arquivo) => import(pathToFileURL(join(raiz, arquivo)).href)
const revisao = raiz => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: raiz, encoding: 'utf8' }).trim()
const revisoes = { hii: revisao(hii), hicode: revisao(hicode) }
const base = mkdtempSync(join(tmpdir(), 'hii-hicode-contrato-'))
const verificacoes = []
function conferir(nome, compativel, observado) {
  verificacoes.push({ nome, compativel, observado })
}

try {
  // Todos os leitores e escritores compartilham apenas fixtures descartaveis.
  for (const chave of Object.keys(process.env)) {
    if (/^(HII|HICODE)_/.test(chave)) delete process.env[chave]
  }
  for (const [chave, valor] of Object.entries({
    ROOT: base, CARDS_DIR: join(base, 'cards'), REPOS_FILE: join(base, 'repos.json'),
    IA_FILE: join(base, 'ia.json'), RUNNER_PIDFILE: join(base, 'runner.pid'),
    RUNNER_LOCK: join(base, 'runner.lock'),
  })) {
    process.env[`HII_${chave}`] = valor
    process.env[`HICODE_${chave}`] = valor
  }
  process.env.HII_HOME = hii
  mkdirSync(join(base, 'cards', 'runs'), { recursive: true })
  mkdirSync(join(base, 'bin'))
  mkdirSync(join(base, 'config'))
  copyFileSync(join(hii, 'config/model-tier.json'), join(base, 'config/model-tier.json'))
  writeFileSync(join(base, 'repos.json'), '[]\n')
  writeFileSync(join(base, 'ia.json'), '{}\n')
  symlinkSync(process.execPath, join(base, 'bin', 'bun'))
  symlinkSync(join(hii, 'bin/hii.ts'), join(base, 'bin', 'hii'))
  process.env.PATH = join(base, 'bin')
  process.chdir(base)

  const cli = await carregar(hicode, 'panel/server/motor/cli.ts')
  assert.equal(cli.resolverEntrypoint()?.origem, 'path')
  const statusCli = await cli.dispatch(['--status'], { timeoutMs: 10000 })
  conferir('cliente usa o binario HII instalado', statusCli.ok, { exitCode: statusCli.exitCode, timedOut: statusCli.timedOut })
  const estadoCli = await cli.dispatch(['estado', '--json'])
  conferir('cliente aceita snapshot JSON', estadoCli.ok, { rejeitadoAntesDoSpawn: estadoCli.exitCode === null })

  const core = await carregar(hicode, 'panel/server/card/acoes.ts')
  const store = await carregar(hii, 'motor/cordel/store.ts')
  const modos = await carregar(hii, 'motor/oswaldo/orquestracao/config.ts')
  const estados = await carregar(hicode, 'panel/shared/status.ts')
  const eventos = await carregar(hicode, 'panel/server/motor/eventos.ts')
  const criadoNoPainel = core.submit({ title: 'Pedido pelo Hicode', repo: 'teste/app' })
  const criado = store.readCard(criadoNoPainel)
  assert.ok(criado, 'fixture escrita pelo painel deve ser legivel pelo HII')
  conferir('armazenamento local compartilhado', criado.fm.title === 'Pedido pelo Hicode', { id: criadoNoPainel })
  conferir('pedido do painel vincula session e modo', Boolean(criado.fm.sessao_id && criado.fm.motor_modo), {
    sessao: criado.fm.sessao_id ?? null, modo: modos.modoDaExecucao(criado.fm),
  })

  const acoes = await carregar(hii, 'motor/mirante/acoes.ts')
  const sessoes = await carregar(hii, 'motor/mirante/execucao-da-sessao.ts')
  const sessao = acoes.submitSession({ title: 'Session HII', repo: 'teste/app' })
  const id = acoes.submit({ title: 'Execucao HII', repo: 'teste/app', sessao_id: sessao, motor_modo: 'gateway' })
  sessoes.registrarPedido(sessao, id, 'gateway', 'Pedido de teste, sem executar IA')
  store.patchCard(id, { status: 'COMPLETED' })
  const fim = eventos.lerNovoFim(id, eventos.novoEstado(id))
  conferir('COMPLETED encerra no consumidor', fim.some(e => e.tipo === 'fim'), {
    statusCanonico: estados.statusCanonicoOuNulo('COMPLETED'), eventos: fim,
  })
  store.patchCard(id, { status: 'CONFIRM' })
  const pausa = eventos.lerNovaPausa(id, eventos.novoEstado(id))
  conferir('CONFIRM pede confirmacao no consumidor', pausa.some(e => e.tipo === 'pausa'), {
    statusCanonico: estados.statusCanonicoOuNulo('CONFIRM'), eventos: pausa,
  })
  store.patchCard(id, { status: 'PR_OPEN', review_verdict: 'APPROVED' })
  conferir('PR_OPEN encerra no consumidor', eventos.lerNovoFim(id, eventos.novoEstado(id)).some(e => e.tipo === 'fim'), 'fim legado')
  conferir('veredito Codefox chega ao consumidor', eventos.lerNovoVeredito(id, eventos.novoEstado(id)).some(e => e.tipo === 'veredito'), 'APPROVED sintetico')

  const leitura = eventos.novoEstado(id)
  const rota = await carregar(hii, 'motor/tomada/rota-log.ts')
  rota.registrarTrocaDeIaNoLiveLog({ id, papel: 'implement', de: 'claude', para: 'codex', falha: 'limite de uso (fixture)', motivo: 'teste sem IA' })
  const bruto = readFileSync(join(base, 'cards', 'runs', `${id}.live.log`), 'utf8')
  assert.ok(bruto.includes('mudando automaticamente para codex'), 'produtor precisa gravar a troca')
  const troca = eventos.lerNovosEventosDoLog(id, leitura)
  conferir('troca de IA gera evento estruturado', troca.length > 0, { logBrutoContemTroca: true, eventos: troca })

  const { snapshotDoMotor } = await carregar(hii, 'motor/mirante/estado-json.ts')
  const { getState } = await carregar(hicode, 'panel/server/utils/state.ts')
  const produtor = snapshotDoMotor({ repo: 'teste/app' })
  const consumidor = getState()
  assert.equal(produtor.conversas.length, 1)
  conferir('painel preserva conversas do HII', Array.isArray(consumidor.conversas) && consumidor.conversas.length === 1, {
    conversasNoHii: produtor.conversas.length, camposNoPainel: Object.keys(consumidor),
  })
  const tarefa = consumidor.cards.find(c => c.id === id)
  conferir('painel preserva vinculo da execucao', tarefa?.sessao_id === sessao, { sessaoNoPainel: tarefa?.sessao_id ?? null })
  const { herdarEnvsAntigas } = await carregar(hii, 'motor/cordel/alicerce/config.ts')
  const ambiente = { HICODE_CARDS_DIR: join(base, 'cards') }
  herdarEnvsAntigas(ambiente, () => {})
  conferir('prefixo HICODE herdado pelo HII', ambiente.HII_CARDS_DIR === ambiente.HICODE_CARDS_DIR, 'compatibilidade de ambiente preservada')
  const { transporteConfigurado } = await carregar(hicode, 'panel/server/motor/transporte.ts')
  conferir('transporte remoto selecionavel', transporteConfigurado() === 'http-sse', transporteConfigurado())

  const lacunas = verificacoes.filter(v => !v.compativel).length
  console.log(JSON.stringify({ revisoes, chamadasDeIa: 0, verificacoes, lacunas }, null, 2))
  process.exitCode = lacunas ? 1 : 0
} finally {
  process.chdir(cwd)
  for (const chave of Object.keys(process.env)) if (!(chave in env)) delete process.env[chave]
  Object.assign(process.env, env)
  rmSync(base, { recursive: true, force: true })
}
