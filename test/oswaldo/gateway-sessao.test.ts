import { test, expect, beforeEach, afterEach } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { submit, submitSession, approvePlan } from '../../motor/mirante/acoes.ts'
import { readCard, patchCard } from '../../motor/cordel/store.ts'
import { registrarPedido } from '../../motor/mirante/execucao-da-sessao.ts'
import { chamarGateway, executarGateway } from '../../motor/oswaldo/gateway.ts'
import { pending, reconcileStranded } from '../../motor/oswaldo/mutirao/estado-da-fila.ts'
import { runProvider } from '../../motor/euclides/tesouro/confianca.ts'
import { harnessPorNome } from '../../motor/tomada/registro.ts'
import { lerSessaoHii, iniciarSubsessao, registrarMensagem } from '../../motor/euclides/sessoes.ts'
import { registrarHarness, esquecerHarness } from '../../motor/tomada/harness-em-voo.ts'
import type { AgentRequest, AgentResult, Harness } from '../../motor/tomada/tipos.ts'

import { aplicar } from '../../motor/tomada/escolha-de-ia.ts'
import { instruir } from '../../motor/mirante/instruir.ts'
import type { EntradaDeRota, DecisaoDeRota } from '../../motor/tomada/rota.ts'

import { pedirEncerramento, cancelarEncerramento } from '../../motor/oswaldo/mutirao/encerramento.ts'

let dir = ''
let anterior: NodeJS.ProcessEnv
beforeEach(() => {
  anterior = { ...process.env }
  dir = mkdtempSync(join(tmpdir(), 'hii-gateway-'))
  process.env.HII_CARDS_DIR = join(dir, 'cards')
  process.env.HII_REPOS_FILE = join(dir, 'repos.json')
  process.env.HII_QUOTA_FALLBACK = 'on'
  mkdirSync(process.env.HII_CARDS_DIR)
  writeFileSync(process.env.HII_REPOS_FILE, JSON.stringify([{ name: 'org/app', path: dir, branch: 'main' }]))
})
afterEach(() => { process.env = anterior; rmSync(dir, { recursive: true, force: true }) })

function pedido(sessao: string, texto = 'mude o arquivo'): string {
  const id = submit({ title: texto, repo: 'org/app', motor_modo: 'gateway', sessao_id: sessao })
  registrarPedido(sessao, id, 'gateway', texto)
  expect(approvePlan(id).ok).toBe(true)
  return id
}

const uso = { tokens_in: 4, tokens_out: 2, tokens_cache_create: 0, tokens_cache_read: 0 }

test('gateway troca na mesma execucao, preserva arquivos e nao reexecuta ao reiniciar', async () => {
  const sessao = submitSession({ title: 'sessao', repo: 'org/app' })
  const id = pedido(sessao)
  const provedores: string[] = []
  await executarGateway(id, {
    chamar: async (card, cwd) => {
      const provedor = card.fm.provider_override_implement || 'claude'
      provedores.push(provedor)
      if (provedor === 'claude') {
        writeFileSync(join(cwd, 'parcial.txt'), 'contexto parcial')
        return { ok: false, cost: '0', costMeasured: false, usage: uso, provider: 'claude', failureClass: 'quota', failureReason: 'limite semanal', reason: 'usage limit reached' }
      }
      expect(readFileSync(join(cwd, 'parcial.txt'), 'utf8')).toBe('contexto parcial')
      expect(card.fm.rota_contexto).toContain('Continue do estado atual')
      return { ok: true, cost: '0', costMeasured: false, usage: uso, provider: 'codex', resultText: 'feito' }
    },
    rota: () => ({ acao: 'trocar', para: 'codex', motivo: 'disponivel' }),
  })
  expect(provedores).toEqual(['claude', 'codex'])
  expect(readCard(id)?.fm.status).toBe('COMPLETED')
  expect(readCard(id)?.fm.worktree).toBeUndefined()
  expect(readCard(id)?.fm.pr_url).toBeUndefined()
  expect(readCard(id)?.fm.tokens_total).toBe('12')
  const log = readFileSync(join(dir, 'cards', 'runs', `${id}.live.log`), 'utf8')
  expect(log).toContain('limite semanal')
  expect(log).toContain('mudando automaticamente para codex')
  expect(readdirSync(join(dir, 'cards', 'runs')).filter(f => f.endsWith('.json')).length).toBe(2)
  reconcileStranded()
  expect(pending()).toEqual([])
  expect(lerSessaoHii(sessao)?.estado).toBe('aberta')
})

test('fila encadeia execucoes e tambem serializa sessions gateway do mesmo projeto', () => {
  const sessao = submitSession({ title: 'primeira', repo: 'org/app' })
  const a = pedido(sessao)
  const b = pedido(sessao)
  const outra = submitSession({ title: 'outra', repo: 'org/app' })
  const c = pedido(outra)
  expect(pending().map(j => j.id)).toEqual([a])
  patchCard(a, { status: 'COMPLETED' })
  expect(pending().map(j => j.id)).toEqual([b])
  patchCard(b, { status: 'COMPLETED' })
  expect(pending().map(j => j.id)).toEqual([c])
})

test('reinicio aguarda o harness vivo e preserva a exclusao por projeto', () => {
  const sessao = submitSession({ title: 'retomada', repo: 'org/app' })
  const id = pedido(sessao)
  iniciarSubsessao(sessao, id, 'codex', '', 'implement')
  pedido(submitSession({ title: 'outra', repo: 'org/app' }))
  registrarHarness(id, process.pid, 'implement')
  try {
    reconcileStranded()
    expect(pending()).toEqual([])
    expect(lerSessaoHii(sessao)?.subsessoes[0]?.estado).toBe('executando')
    expect(readCard(id)?.fm.reconciled).toBeUndefined()
  } finally { esquecerHarness(id, process.pid) }
  reconcileStranded()
  expect(lerSessaoHii(sessao)?.subsessoes[0]?.estado).toBe('interrompida')
  expect(pending().map(j => j.id)).toEqual([id])
})

test('parada humana durante a chamada nao vira concluido nem troca de IA', async () => {
  const id = pedido(submitSession({ title: 'parada', repo: 'org/app' }))
  await executarGateway(id, {
    chamar: async () => {
      patchCard(id, { status: 'HALTED', halt_class: 'humano' })
      return { ok: false, cost: '0', failureClass: 'quota' }
    },
    rota: () => { throw new Error('nao deve rotear apos parada') },
  })
  expect(readCard(id)?.fm.status).toBe('HALTED')
})

test('duas IAs recebem o contexto duravel e deixam subsessoes reais sem ID nativo inventado', async () => {
  const sessao = submitSession({ title: 'contexto', repo: 'org/app' })
  const id = pedido(sessao, 'Preserve a API publica')
  const req: AgentRequest = { prompt: 'continue', cwd: dir, dirs: [dir], mode: 'edit', useAgents: false, timeoutMs: 1000 }
  const resultado: AgentResult = { ok: true, failed: false, timedOut: false, isError: false, detail: '', text: 'API preservada', cost: 0, costMeasured: false, usage: uso }
  for (const nome of ['claude', 'codex']) {
    await runProvider(id, Object.assign(Object.create(harnessPorNome(nome)) as Harness, { run: async (r: AgentRequest) => {
      expect(r.prompt).toContain('Preserve a API publica')
      if (nome === 'codex') expect(r.prompt).toContain('API preservada')
      return resultado
    } }), req, 'implement')
  }
  const s = lerSessaoHii(sessao)!
  expect(s.subsessoes.map(s => s.provedor)).toEqual(['claude', 'codex'])
  expect(s.subsessoes.every(s => s.estado === 'concluida' && s.nativa === null)).toBe(true)
})

test('excecao do harness fecha a subsessao com falha', async () => {
  const sessao = submitSession({ title: 'erro', repo: 'org/app' })
  const id = pedido(sessao)
  let falhou = false
  try {
    await runProvider(id, Object.assign(Object.create(harnessPorNome('codex')) as Harness, { run: async () => { throw new Error('quebrou') } }),
      { prompt: 'x', cwd: dir, dirs: [dir], mode: 'edit', useAgents: false, timeoutMs: 1000 })
  } catch { falhou = true }
  expect(falhou).toBe(true)
  expect(lerSessaoHii(sessao)?.subsessoes[0]?.estado).toBe('falhou')
})

// Falhas precisam sair da execucao com estado, acao e diagnostico consultaveis.
for (const caso of [
  { nome: 'cota sem destino', detalhe: 'usage limit reached: weekly limit', classe: 'quota', status: 'HALTED', acao: 'escolha outra IA' },
  { nome: 'autenticacao', detalhe: '401 unauthorized', classe: 'terminal', status: 'HALTED', acao: '/login' },
  { nome: 'CLI ausente', detalhe: 'spawn codex ENOENT', classe: 'terminal', status: 'HALTED', acao: 'instale' },
  { nome: 'timeout', detalhe: 'timeout', classe: 'transient', status: 'WAITING', acao: 'retomada automatica', timeout: true },
  { nome: 'stream interrompido', detalhe: 'ECONNRESET durante stream', classe: 'transient', status: 'WAITING', acao: 'retomada automatica' },
]) test(`gateway: ${caso.nome} explica proxima acao e preserva diagnostico sem segredo`, async () => {
  process.env.HII_IA_FILE = join(dir, 'ia.json')
  process.env.HII_TEST_SECRET = 'segredo-gateway-nao-publico'
  const id = pedido(submitSession({ title: caso.nome, repo: 'org/app' }))
  const h = harnessPorNome('codex')
  const original = h.run
  aplicar({ papeis: ['implement'], provider: 'codex' })
  h.run = async () => ({ ok: false, failed: true, timedOut: !!caso.timeout, isError: true,
    detail: `${caso.detalhe}\nsegredo-gateway-nao-publico\nFIM-BRUTO`, text: 'SAIDA-DO-STREAM segredo-gateway-nao-publico', cost: 0, costMeasured: false, usage: uso })
  try {
    await executarGateway(id, { chamar: chamarGateway, rota: () => ({ acao: 'manter_politica_atual', motivo: 'nenhum candidato apto' }) })
    const card = readCard(id)!
    expect(card.fm.status).toBe(caso.status)
    expect(card.fm.halt_class || (card.fm.wait_class ? 'transient' : '')).toBe(caso.classe)
    const log = readFileSync(join(dir, 'cards', 'runs', `${id}.live.log`), 'utf8')
    expect(log).toContain('IA codex falhou:')
    expect(log).toContain(caso.acao)
    expect(log).toContain('diagnostico:')
    expect(log).not.toContain('FIM-BRUTO')
    const arquivos = readdirSync(join(dir, 'cards'), { recursive: true }).filter(f => String(f).endsWith('.json') || String(f).endsWith('.md') || String(f).endsWith('.log'))
    const persistido = arquivos.map(f => readFileSync(join(dir, 'cards', String(f)), 'utf8')).join('\n')
    expect(persistido).not.toContain('segredo-gateway-nao-publico')
    expect(persistido).toContain('FIM-BRUTO')
    const diagnosticos = readdirSync(join(dir, 'cards', 'diagnosticos')).map(f => readFileSync(join(dir, 'cards', 'diagnosticos', f), 'utf8')).join('\n')
    expect(diagnosticos).toContain('SAIDA-DO-STREAM')
    expect(diagnosticos).toContain('FIM-BRUTO')
  } finally { h.run = original }
})

test('excecao de stream vira espera registrada em vez de abandonar EXECUTING', async () => {
  process.env.HII_IA_FILE = join(dir, 'ia.json')
  aplicar({ papeis: ['implement'], provider: 'codex' })
  const id = pedido(submitSession({ title: 'stream lancou', repo: 'org/app' }))
  await executarGateway(id, {
    chamar: async () => { throw new Error('ECONNRESET stream interrompido') },
    rota: () => { throw new Error('falha transitoria nao troca') },
  })
  expect(readCard(id)?.fm.status).toBe('WAITING')
  expect(readCard(id)?.fm.wait_class).toBe('rede')
  expect(readFileSync(join(dir, 'cards', 'runs', `${id}.live.log`), 'utf8')).toContain('retomada automatica')
})

test('duas trocas preservam instrucoes, efeitos e autoria da mesma execucao sem repetir ao reiniciar', async () => {
  process.env.HII_IA_FILE = join(dir, 'ia.json')
  aplicar({ papeis: ['implement'], provider: 'codex', model: 'modelo-inicial' })
  const sessao = submitSession({ title: 'continuidade', repo: 'org/app' })
  const conversa = [
    ['ia', 'Qual contrato deve permanecer?'], ['humano', 'Decisao: manter /v1/clientes.'],
    ['ia', 'Qual cor aplicar?'], ['humano', 'Resposta humana: azul.'],
    ['ia', 'Onde esta a especificacao?'], ['humano', 'Artefato aprovado: decisao.txt.'],
  ] as const
  for (const [autor, texto] of conversa) registrarMensagem(sessao, { autor, texto, execucao: '', provedor: autor === 'ia' ? 'codex' : '', modelo: '' })
  writeFileSync(join(dir, 'decisao.txt'), 'manter /v1/clientes; azul')
  const id = pedido(sessao, 'Preserve a API publica')
  expect(instruir(id, 'Mantenha o contrato HTTP').ok).toBe(true)
  const nomes = ['codex', 'claude', 'ollama']
  const restaurar: (() => void)[] = []
  const chamadas: string[] = []
  for (const [i, nome] of nomes.entries()) {
    const h = harnessPorNome(nome)
    const original = h.run
    const agentic = Object.getOwnPropertyDescriptor(h, 'agentic')!
    Object.defineProperty(h, 'agentic', { value: true, configurable: true })
    restaurar.push(() => { h.run = original; Object.defineProperty(h, 'agentic', agentic) })
    h.run = async r => {
      chamadas.push(nome)
      expect(r.cwd).toBe(dir)
      expect(r.prompt).toContain('Preserve a API publica')
      expect(r.prompt).toContain('Mantenha o contrato HTTP')
      for (const [, texto] of conversa) expect(r.prompt).toContain(texto)
      expect(readFileSync(join(dir, 'decisao.txt'), 'utf8')).toBe('manter /v1/clientes; azul')
      for (const anterior of nomes.slice(0, i)) expect(readFileSync(join(dir, `${anterior}.efeito`), 'utf8')).toBe('unico')
      if (i) {
        expect(r.prompt).toContain('Continue do estado atual')
        expect(r.prompt).toContain('Instrucao entre tentativas')
        expect(r.prompt).toContain('resultado parcial codex')
      }
      writeFileSync(join(dir, `${nome}.efeito`), 'unico', { flag: 'wx' })
      if (i === 0) expect(instruir(id, 'Instrucao entre tentativas').ok).toBe(true)
      return { ok: i === 2, failed: i !== 2, timedOut: false, isError: i !== 2,
        detail: i < 2 ? 'usage limit reached: weekly limit' : '', text: `resultado parcial ${nome}`, cost: 0, costMeasured: false, usage: uso }
    }
  }
  const deps = { chamar: chamarGateway, rota: (e: EntradaDeRota): DecisaoDeRota => ({ acao: 'trocar', para: e.provedorAtual === 'codex' ? 'claude' : 'ollama', motivo: 'fixture apta' }) }
  try {
    await executarGateway(id, deps)
    await executarGateway(id, deps)
    expect(chamadas).toEqual(nomes)
    expect(readCard(id)?.fm.status).toBe('COMPLETED')
    expect(readCard(id)?.fm.tokens_total).toBe('18')
    const s = lerSessaoHii(sessao)!
    expect(s.execucoes.map(e => e.id)).toEqual([id])
    expect(s.subsessoes.map(s => s.provedor)).toEqual(nomes)
    expect(s.subsessoes.map(s => s.estado)).toEqual(['falhou', 'falhou', 'concluida'])
    expect(s.mensagens.filter(m => m.autor === 'ia' && m.execucao === id).map(m => m.provedor)).toEqual(nomes)
  } finally { for (const f of restaurar) f() }
})

for (const ok of [false, true]) test(`encerramento do daemon preserva custos e ${ok ? 'conclui sucesso recebido' : 'deixa falha para retomar no reinicio'}`, async () => {
  const id = pedido(submitSession({ title: 'encerramento', repo: 'org/app' }))
  try {
    await executarGateway(id, {
      chamar: async () => {
        pedirEncerramento()
        return { ok, cost: '0.25', usage: uso, provider: 'codex', reason: 'SIGTERM', failureClass: 'terminal' }
      },
      rota: () => { throw new Error('nao deve rotear durante encerramento') },
    })
    expect(readCard(id)?.fm.status).toBe(ok ? 'COMPLETED' : 'EXECUTING')
    expect(readCard(id)?.fm.cost_usd).toBe('0.2500')
    expect(readCard(id)?.fm.tokens_total).toBe('6')
  } finally { cancelarEncerramento() }
})
