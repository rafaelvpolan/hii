import { test, expect, beforeEach, afterAll } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const criados: string[] = []
let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hicode-ledger-cfg-'))
  criados.push(dir)
  mkdirSync(join(dir, 'runs'), { recursive: true })
  process.env.HICODE_CARDS_DIR = dir
})

afterAll(() => {
  for (const d of criados) rmSync(d, { recursive: true, force: true })
  delete process.env.HICODE_CARDS_DIR
})

test('REGRESSAO o /config le o ledger que o motor REALMENTE escreve, passando pelo escritor de verdade', async () => {
  const { registrarChamada } = await import('../lib/runner/ias-da-sessao')
  const { sessaoParaChamada } = await import('../lib/runner/cost-trust')
  const { lerConfig } = await import('../motor/cdl/ali/snapshot')

  registrarChamada(sessaoParaChamada(''), {
    ts: new Date().toISOString(), papel: 'conversa', provedor: 'claude', modelo: 'opus',
    custoUsd: 0.42, custoMedido: true, tokens: 1000, tokensEntrada: 600, tokensSaida: 400,
    tokensCache: 0, duracaoS: 3, ok: true,
  })

  const cfg = lerConfig('', '')
  expect(cfg.sessao.papeis.length).toBe(1)
  expect(cfg.sessao.papeis[0]?.provedor).toBe('claude')
  expect(cfg.sessao.papeis[0]?.modelo).toBe('opus')
  expect(cfg.sessao.custoUsd).toBeCloseTo(0.42, 4)
  expect(cfg.sessao.tokens).toBe(1000)
})

test('sessao sem nenhuma chamada devolve painel vazio, sem inventar papel', async () => {
  const { lerConfig } = await import('../motor/cdl/ali/snapshot')
  expect(lerConfig('', '').sessao.papeis).toEqual([])
})
