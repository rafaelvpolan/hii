import { test, expect, beforeEach, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HORA_MS = 60 * 60 * 1000
const criados: string[] = []
let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hicode-sessao-longa-'))
  criados.push(dir)
  mkdirSync(join(dir, 'runs'), { recursive: true })
  process.env.HICODE_CARDS_DIR = dir
  process.env.HICODE_COTA_TTL_MS = '0'
})

afterAll(() => {
  for (const d of criados) rmSync(d, { recursive: true, force: true })
  delete process.env.HICODE_CARDS_DIR
  delete process.env.HICODE_COTA_TTL_MS
})

function carimbo(ms: number): string {
  return new Date(ms).toISOString().replace(/[^0-9]/g, '').slice(0, 14)
}

function gravarConversa(abertaHaMs: number, ultimaChamadaHaMs: number): void {
  const abertura = Date.now() - abertaHaMs
  const ultima = Date.now() - ultimaChamadaHaMs
  const caminho = join(dir, 'runs', `conversa-${carimbo(abertura)}-123.json`)
  writeFileSync(caminho, JSON.stringify({
    id: '', ts: new Date(ultima).toISOString().replace(/\.\d+Z$/, 'Z'), ok: true,
    cost_usd: '3.0000', duration_s: 1, tokens_in: 0, tokens_out: 0,
    tokens_cache_create: 0, tokens_cache_read: 0, tokens_total: 50, steps: null,
    provider: 'claude', model: '', kind: 'conversa', failure_class: '', failure_reason: '',
  }, null, 2))
  utimesSync(caminho, ultima / 1000, ultima / 1000)
}

test('REGRESSAO REPL aberto ha mais de 4h nao some da janela de cota', async () => {
  const { lerCota } = await import('../../motor/euclides/tesouro/cota.ts')
  gravarConversa(9 * HORA_MS, 10 * 60 * 1000)
  const cota = lerCota(Date.now())
  expect(cota.custoUsd).toBeCloseTo(3, 4)
  expect(cota.runs).toBe(1)
})

test('sessao de conversa realmente velha continua fora da janela', async () => {
  const { lerCota } = await import('../../motor/euclides/tesouro/cota.ts')
  gravarConversa(9 * HORA_MS, 8 * HORA_MS)
  expect(lerCota(Date.now()).runs).toBe(0)
})
