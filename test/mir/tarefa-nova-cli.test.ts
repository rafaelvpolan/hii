import { test, expect, beforeEach, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const criados: string[] = []
let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hicode-tarefa-nova-'))
  criados.push(dir)
  mkdirSync(join(dir, 'runs'), { recursive: true })
  process.env.HICODE_CARDS_DIR = dir
  const repos = join(dir, 'repos.json')
  writeFileSync(repos, JSON.stringify([{ name: 'org/app', path: dir }]))
  process.env.HICODE_REPOS_FILE = repos
})

afterAll(() => {
  for (const d of criados) rmSync(d, { recursive: true, force: true })
  delete process.env.HICODE_CARDS_DIR
  delete process.env.HICODE_REPOS_FILE
})

test('cria a tarefa, devolve o id e ja deixa na fila', async () => {
  const { criarTarefa } = await import('../../motor/mir/comandos-de-tarefa.ts')
  const r = criarTarefa('trocar a cor do botao', 'org/app')
  expect(r.ok).toBe(true)
  expect(r.id).toMatch(/^\d+$/)
  expect(r.acao).toBe('criar')
})

test('o card fica em disco com o titulo e o repo pedidos', async () => {
  const { criarTarefa } = await import('../../motor/mir/comandos-de-tarefa.ts')
  const r = criarTarefa('trocar a cor do botao', 'org/app')
  const arquivo = readdirSync(dir).find(f => f.startsWith(r.id) && f.endsWith('.md'))
  expect(arquivo).toBeTruthy()
  const texto = readFileSync(join(dir, arquivo ?? ''), 'utf8')
  expect(texto).toContain('trocar a cor do botao')
  expect(texto).toContain('repo: org/app')
})

test('o id criado aparece no snapshot que o painel lê', async () => {
  const { criarTarefa } = await import('../../motor/mir/comandos-de-tarefa.ts')
  const { snapshotDoMotor } = await import('../../motor/mir/estado-json.ts')
  const r = criarTarefa('trocar a cor do botao', 'org/app')
  const snap = snapshotDoMotor({ repo: 'org/app' })
  expect(JSON.stringify(snap)).toContain(r.id)
})

test('sem texto ou sem repo, recusa dizendo o que falta — nao cria card mudo', async () => {
  const { criarTarefa } = await import('../../motor/mir/comandos-de-tarefa.ts')
  expect(criarTarefa('', 'org/app').mensagem).toContain('o que a tarefa deve fazer')
  expect(criarTarefa('x', '').mensagem).toContain('--repo')
  expect(readdirSync(dir).filter(f => f.endsWith('.md'))).toEqual([])
})

test('REGRESSAO repo nao registrado é recusado na porta, em vez de virar card que para em HALTED', async () => {
  const { criarTarefa } = await import('../../motor/mir/comandos-de-tarefa.ts')
  const r = criarTarefa('x', 'org/fantasma')
  expect(r.ok).toBe(false)
  expect(r.mensagem).toContain('nao esta registrado')
  expect(readdirSync(dir).filter(f => f.endsWith('.md'))).toEqual([])
})
