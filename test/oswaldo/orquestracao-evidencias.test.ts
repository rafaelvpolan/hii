import { test, expect, beforeEach, afterEach } from '../apoio/runner.ts'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { coletarEvidencias, evidenciaAtual } from '../../motor/oswaldo/orquestracao/evidencias.ts'
import { planoOrquestrado } from '../fixtures/plano-orquestrado.ts'

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
  const r = await coletarEvidencias(plano, 1, dir)
  expect(r.aprovado).toBe(true)
  expect(r.evidencias[0]?.exitCode).toBe(0)
  expect(await evidenciaAtual(plano.id, 1, dir)).toBe(true)
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
    if (tipo === 'timeout') expect(r.evidencias[0]?.timeout).toBe(true)
  }
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
