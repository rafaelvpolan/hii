import { test, expect, beforeEach, afterAll } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const criados: string[] = []
let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hicode-cota-atrib-'))
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

function ia(papel: string, provedor: string, classeDeFalha = '') {
  return {
    papel, rotulo: papel, provedor, modelo: 'm', custoUsd: 0.01, custoMedido: true,
    tokens: 10, tokensEntrada: 5, tokensSaida: 5, tokensCache: 0, duracaoS: 1,
    chamadas: 1, falhas: classeDeFalha ? 1 : 0, classeDeFalha,
  }
}

function gravarRun(nome: string, corpo: Record<string, unknown>): void {
  const quandoMs = Date.now() - 3600_000
  const quando = new Date(quandoMs).toISOString().replace(/\.\d+Z$/, 'Z')
  const carimbo = new Date(quandoMs).toISOString().replace(/[^0-9]/g, '').slice(0, 14)
  writeFileSync(join(dir, 'runs', `${nome}-${carimbo}.json`), JSON.stringify({
    id: nome, ts: quando, ok: false, cost_usd: '0.02', duration_s: 2,
    tokens_in: 10, tokens_out: 10, tokens_cache_create: 0, tokens_cache_read: 0, tokens_total: 20,
    steps: null, model: '', failure_reason: 'limite', ...corpo,
  }, null, 2))
}

test('REGRESSAO cota estourada no gate marca o provedor do GATE, nao o do implement', async () => {
  const { lerCota } = await import('../../motor/euc/tsr/cota.ts')
  gravarRun('001', {
    provider: 'claude',
    failure_class: 'quota',
    ias: [ia('implement', 'claude'), ia('gate', 'kimi', 'quota')],
  })
  const cota = lerCota(Date.now())
  const kimi = cota.provedores.find(p => p.provedor === 'kimi')
  const claude = cota.provedores.find(p => p.provedor === 'claude')
  expect(kimi?.limiteAtingido).toBe(true)
  expect(claude?.limiteAtingido).toBe(false)
})

test('registro antigo sem ledger continua caindo no provedor do topo', async () => {
  const { lerCota } = await import('../../motor/euc/tsr/cota.ts')
  gravarRun('002', { provider: 'claude', failure_class: 'quota', ias: [] })
  const cota = lerCota(Date.now())
  expect(cota.provedores.find(p => p.provedor === 'claude')?.limiteAtingido).toBe(true)
})

test('REGRESSAO classeDeFalha sobrevive ao ida-e-volta do ledger — sem isso a atribuicao de cota e cega', async () => {
  const { registrarChamada, chamadasDaSessao, agregarPorIa } = await import('../../motor/euc/ias-da-sessao.ts')
  registrarChamada('001-20260101000000', {
    ts: new Date().toISOString(), papel: 'gate', provedor: 'kimi', modelo: 'k2',
    custoUsd: 0.1, custoMedido: true, tokens: 10, tokensEntrada: 5, tokensSaida: 5,
    tokensCache: 0, duracaoS: 1, ok: false, classeDeFalha: 'quota',
  })
  const lidas = chamadasDaSessao('001-20260101000000')
  expect(lidas[0]?.classeDeFalha).toBe('quota')
  expect(agregarPorIa(lidas)[0]?.classeDeFalha).toBe('quota')
})

test('classe de falha desconhecida no ledger nao vira classe valida', async () => {
  const { registrarChamada, chamadasDaSessao } = await import('../../motor/euc/ias-da-sessao.ts')
  registrarChamada('002-20260101000000', {
    ts: new Date().toISOString(), papel: 'gate', provedor: 'kimi', modelo: 'k2',
    custoUsd: 0, custoMedido: true, tokens: 0, tokensEntrada: 0, tokensSaida: 0,
    tokensCache: 0, duracaoS: 1, ok: false,
    classeDeFalha: 'coisa-inventada' as never,
  })
  expect(chamadasDaSessao('002-20260101000000')[0]?.classeDeFalha).toBe('')
})
