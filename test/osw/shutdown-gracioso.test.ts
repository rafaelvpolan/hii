import { test, expect, afterEach, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-shutdown-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(join(process.env.HICODE_CARDS_DIR, 'runs'), { recursive: true })
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const enc = await import('../../motor/osw/mtr/encerramento.ts')
const fila = await import('../../motor/osw/mtr/estado-da-fila.ts')
const { lerSaude, respostaDeSaude, subirServidorDeSaude } = await import('../../motor/euc/rdr/servidor.ts')
const { createCard } = await import('../../motor/cdl/store.ts')

afterEach(() => {
  enc.cancelarEncerramento()
  for (const id of ['a', 'b']) fila.liberar(id)
})

test('drenando, a fila para de entregar trabalho novo', () => {
  createCard({ status: 'EXECUTING', title: 't', repo: 'org/app', risk: 'low' }, '## Objetivo\nx\n')
  expect(fila.pending().length).toBeGreaterThan(0)
  enc.pedirEncerramento()
  expect(fila.pending(), 'card novo nao pode entrar depois do SIGTERM').toEqual([])
})

test('espera o que esta em voo antes de encerrar, e sai limpo quando esvazia', async () => {
  fila.marcarEmVoo('a')
  const saidas: number[] = []
  const logs: string[] = []
  const promessa = enc.encerrarComGraca({ log: l => logs.push(l), sair: c => saidas.push(c), tetoMs: 2000 })
  setTimeout(() => fila.liberar('a'), 60)
  await promessa
  expect(saidas).toEqual([0])
  expect(logs.join(' ')).toContain('fila drenada')
})

test('teto de espera estourado sai com codigo != 0 — o encerramento NAO foi limpo', async () => {
  fila.marcarEmVoo('b')
  const saidas: number[] = []
  const logs: string[] = []
  await enc.encerrarComGraca({ log: l => logs.push(l), sair: c => saidas.push(c), tetoMs: 120 })
  expect(saidas, 'sair 0 aqui mentiria para quem orquestra o container').toEqual([1])
  expect(logs.join(' ')).toContain('teto de espera estourou')
  fila.liberar('b')
})

test('/health responde 200 quando o motor esta de pe', () => {
  const r = respostaDeSaude('/health')
  expect(r.status).toBe(200)
})

test('/health responde 503 enquanto drena — o balanceador precisa tirar este processo', async () => {
  enc.pedirEncerramento()
  const r = respostaDeSaude('/health')
  expect(r.status).toBe(503)
  const corpo = JSON.parse(r.corpo) as { ok: boolean; encerrando: boolean }
  expect(corpo.ok).toBe(false)
  expect(corpo.encerrando).toBe(true)
})

test('qualquer outro caminho e 404 — o servidor nao expoe mais nada', () => {
  expect(respostaDeSaude('/').status).toBe(404)
  expect(respostaDeSaude('/cards').status).toBe(404)
})

test('a leitura de saude conta o que esta em voo e o que esta pendente', () => {
  fila.marcarEmVoo('a')
  const s = lerSaude()
  expect(s.emVoo).toBe(1)
  expect(typeof s.pendentes).toBe('number')
  fila.liberar('a')
})

test('sem HICODE_HEALTH_PORT o servidor nao sobe — nao abre porta sem pedir', () => {
  delete process.env.HICODE_HEALTH_PORT
  expect(subirServidorDeSaude()).toBeNull()
})

test('com porta configurada, o servidor sobe e responde de verdade', async () => {
  const s = subirServidorDeSaude(0)
  expect(s).not.toBeNull()
  if (!s) return
  try {
    // `await s.pronto`, e nao `s.porta` na linha seguinte ao listen: `listen` e
    // assincrono no node, e ler a porta antes devolvia 0 (a porta 0 e efemera, o
    // SO so decide durante o listen). Sob bun funcionava por acidente de
    // implementacao, e era so isso que mantinha este teste verde.
    const porta = await s.pronto
    expect(porta, 'porta efemera tem de ser conhecida antes de sondar').toBeGreaterThan(0)
    const r = await fetch(`http://localhost:${porta}/health`)
    expect(r.status).toBe(200)
    expect(((await r.json()) as { ok: boolean }).ok).toBe(true)
  } finally {
    s.parar()
  }
})

const { categoriaDoErro, enderecoDeSaude } = await import('../../motor/euc/rdr/servidor.ts')

// Achados do Escudo, confirmados pelo Crivo com linha exata.
test('REGRESSAO /health nao devolve a mensagem crua de erro — ela carrega caminho e usuario do host', () => {
  expect(categoriaDoErro('checkMerged: ENOENT /home/fulano/projects/x/.hii/y')).toBe('falha em checkMerged')
  expect(categoriaDoErro('')).toBe('')
  const corpo = JSON.stringify(lerSaude())
  expect(corpo).not.toContain('/home/')
})

test('REGRESSAO /health liga em loopback por padrao — Bun.serve sem hostname abre em 0.0.0.0', () => {
  delete process.env.HICODE_HEALTH_BIND
  expect(enderecoDeSaude()).toBe('127.0.0.1')
})

test('expor o /health alem do loopback exige intencao explicita do operador', () => {
  process.env.HICODE_HEALTH_BIND = '0.0.0.0'
  expect(enderecoDeSaude()).toBe('0.0.0.0')
  delete process.env.HICODE_HEALTH_BIND
})
