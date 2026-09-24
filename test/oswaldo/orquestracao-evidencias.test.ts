import { test, expect, beforeEach, afterEach } from '../apoio/runner.ts'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, readdirSync, readFileSync, chmodSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { coletarEvidencias, evidenciaAtual, fingerprintDoTrabalho } from '../../motor/oswaldo/orquestracao/evidencias.ts'
import { relatorioConsistente } from '../../motor/oswaldo/orquestracao/validacao-evidencias.ts'
import { planoOrquestrado } from '../fixtures/plano-orquestrado.ts'
import { registrarChamada } from '../../motor/euclides/ias-da-sessao.ts'

let dir = ''
let anterior: NodeJS.ProcessEnv
beforeEach(() => {
  anterior = { ...process.env }
  dir = mkdtempSync(join(tmpdir(), 'hii-evidencia-'))
  process.env.HII_CARDS_DIR = join(dir, '.git', 'estado')
  execFileSync('git', ['init', '-q', dir])
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'base'])
})
afterEach(() => { process.env = anterior; rmSync(dir, { recursive: true, force: true }) })

test('evidencia executa processo real e invalida quando aparece novo diff', async () => {
  const plano = planoOrquestrado()
  registrarChamada(plano.sessaoId, { ts: new Date().toISOString(), papel: 'implement', provedor: 'ollama', modelo: 'qwen', custoUsd: 0,
    custoMedido: true, tokens: 5, tokensEntrada: 3, tokensSaida: 2, tokensCache: 0, duracaoS: 1, ok: true, classeDeFalha: '' })
  const r = await coletarEvidencias(plano, 1, dir)
  expect(r.aprovado).toBe(true)
  expect(r.evidencias[0]?.exitCode).toBe(0)
  expect(await evidenciaAtual(plano.id, 1, dir)).toBe(true)
  expect(r.pacote?.chamadas).toHaveLength(1)
  expect(r.pacote?.tokens).toBe(5)
  expect(r.pacote?.custo.qualidade).toBe('medido')
  expect(r.pacote?.rollout).toEqual(plano.rollout)
  expect(r.pacote?.politica.versao).toBe(1)
  writeFileSync(join(dir, 'novo.txt'), 'nova alteracao')
  expect(await evidenciaAtual(plano.id, 1, dir)).toBe(false)
})

test('exit diferente de zero, timeout e ausencia de comando nao aprovam', async () => {
  for (const tipo of ['falha', 'timeout', 'ausente']) {
    const plano = planoOrquestrado()
    const c = plano.criterios[0]!
    if (tipo === 'ausente') delete c.comando
    else c.comando = { binario: process.execPath, argumentos: ['-e', tipo === 'falha' ? 'process.exit(7)' : 'setTimeout(()=>{},10000)'], diretorio: '.', timeoutMs: tipo === 'timeout' ? 40 : 3000 }
    const r = await coletarEvidencias(plano, 1, dir)
    expect(r.aprovado).toBe(false)
    expect(r.evidencias[0]?.estado).toBe(tipo === 'falha' ? 'reprovado' : 'inconclusivo')
    expect(r.evidencias[0]?.falha).toBe(tipo === 'falha' ? 'codigo-saida' : tipo === 'timeout' ? 'timeout' : 'evidencia-ausente')
    if (tipo === 'timeout') expect(r.evidencias[0]?.timeout).toBe(true)
  }
})

test('ferramenta ausente, sinal e erro de ambiente ficam distintos no artefato', async () => {
  const casos = [
    { esperado: 'ferramenta-ausente', executar: async () => ({ stdout: '', stderr: '', err: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }) }) },
    { esperado: 'sinal', executar: async () => ({ stdout: '', stderr: '', err: Object.assign(new Error('morto'), { signal: 'SIGTERM' }) }) },
    { esperado: 'ambiente', executar: async () => ({ stdout: '', stderr: '', err: Object.assign(new Error('permissao'), { code: 'EACCES' }) }) },
  ] as const
  for (const caso of casos) {
    const r = await coletarEvidencias(planoOrquestrado(), 1, dir, caso.executar as never)
    expect(r.aprovado).toBe(false)
    expect(r.evidencias[0]?.falha).toBe(caso.esperado)
  }
})

test('relatorio adulterado nao muda aprovacao nem justificativa nao aplicavel', async () => {
  const plano = planoOrquestrado()
  plano.criterios.push({ id: 'documentacao', descricao: 'nao se aplica', obrigatorio: false, naoAplicavel: 'Mudanca interna sem interface publica.' })
  const r = await coletarEvidencias(plano, 1, dir)
  const revisao = { versao: 1 as const, revisao: 1, hash: 'a'.repeat(64), chave: 'teste', criadoEm: new Date().toISOString(), plano }
  expect(relatorioConsistente(r, revisao)).toBe(true)
  expect(relatorioConsistente({ ...r, aprovado: false }, revisao)).toBe(false)
  r.evidencias.find(e => e.criterio === 'documentacao')!.saida = 'dispensado sem motivo'
  expect(relatorioConsistente(r, revisao)).toBe(false)
})

test('saida redige segredo; comando que muda o trabalho nao valida o proprio resultado', async () => {
  process.env.TEST_SECRET = 'credencial-super-secreta'
  const plano = planoOrquestrado()
  plano.criterios[0]!.comando = { binario: process.execPath, argumentos: ['-e', "console.log(process.env.TEST_SECRET);import('node:fs').then(fs=>fs.writeFileSync('mudou.txt','x'))"], diretorio: '.', timeoutMs: 3000 }
  const r = await coletarEvidencias(plano, 1, dir)
  expect(r.aprovado).toBe(false)
  expect(r.evidencias[0]?.saida).toContain('[REDACTED]')
  expect(r.evidencias[0]?.saida).not.toContain(process.env.TEST_SECRET)
})

test('diretorio por symlink externo e recusado antes de executar', async () => {
  // Ignorado pelo git: o fingerprint nao segue o link externo.
  writeFileSync(join(dir, '.gitignore'), 'fora\n')
  symlinkSync(tmpdir(), join(dir, 'fora'))
  const plano = planoOrquestrado()
  plano.criterios[0]!.comando!.diretorio = 'fora'
  const r = await coletarEvidencias(plano, 1, dir, async () => { throw new Error('nao deve executar') })
  expect(r.aprovado).toBe(false)
  expect(r.evidencias[0]?.saida).toContain('sai do worktree')
})

test('retry preserva evidencia anterior em vez de sobrescrever a falha', async () => {
  const plano = planoOrquestrado()
  plano.criterios[0]!.comando = { binario: process.execPath, argumentos: ['-e', 'process.exit(7)'], diretorio: '.', timeoutMs: 3000 }
  const falha = await coletarEvidencias(plano, 1, dir)
  plano.criterios[0]!.comando.argumentos = ['-e', 'process.exit(0)']
  const sucesso = await coletarEvidencias(plano, 1, dir)
  expect(falha.tentativa).not.toBe(sucesso.tentativa)
  const historico = readdirSync(join(process.env.HII_CARDS_DIR!, 'evidencias')).filter(n => n !== `${plano.id}-1.json`)
  expect(historico.length).toBe(2)
  expect(historico.some(n => readFileSync(join(process.env.HII_CARDS_DIR!, 'evidencias', n), 'utf8').includes('"reprovado"'))).toBe(true)
})

test('fingerprint ignora diff externo e textconv configurados pelo projeto', async () => {
  writeFileSync(join(dir, 'arquivo.txt'), 'antes')
  execFileSync('git', ['-C', dir, 'add', 'arquivo.txt'])
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'arquivo'])
  const script = join(dir, '.git', 'efeito.sh')
  const marcador = join(dir, '.git', 'efeito')
  writeFileSync(script, '#!/bin/sh\nprintf efeito > "' + marcador + '"\n')
  chmodSync(script, 0o755)
  execFileSync('git', ['-C', dir, 'config', 'diff.external', script])
  execFileSync('git', ['-C', dir, 'config', 'diff.fixture.textconv', script])
  execFileSync('git', ['-C', dir, 'config', 'core.fsmonitor', script])
  writeFileSync(join(dir, '.gitattributes'), '*.txt diff=fixture\n')
  writeFileSync(join(dir, 'arquivo.txt'), 'depois')
  const antes = await fingerprintDoTrabalho(dir)
  expect(existsSync(marcador)).toBe(false)
  writeFileSync(join(dir, 'arquivo.txt'), 'outra mudanca')
  expect(await fingerprintDoTrabalho(dir)).not.toBe(antes)
  expect(existsSync(marcador)).toBe(false)
})

test('duracao da evidencia nao fica negativa quando o relogio civil recua', async () => {
  const data = Date.now
  try {
    const r = await coletarEvidencias(planoOrquestrado(), 1, dir, async () => {
      Date.now = () => data() - 60000
      return { stdout: 'comando simulado para medir duracao', stderr: '', err: null }
    })
    expect(r.evidencias[0]!.duracaoMs >= 0).toBe(true)
  } finally { Date.now = data }
})
