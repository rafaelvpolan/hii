import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hii-teto-tokens-'))
afterAll(() => {
  rmSync(BASE, { recursive: true, force: true })
  delete process.env.HII_TIER_FILE
  delete process.env.HII_CARD_BUDGET_TOKENS
})

const G = await import('../../motor/euclides/tesouro/orcamento.ts')

type OrcamentoBruto = Record<string, number | string>

let n = 0
function comArquivo<T>(orcamentoPorCard: OrcamentoBruto, fn: () => T): T {
  const caminho = join(BASE, `tier-${n++}.json`)
  writeFileSync(caminho, JSON.stringify({ versao: 1, padrao: 'tier2_padrao', criterios: {}, orcamentoPorCard }))
  process.env.HII_TIER_FILE = caminho
  try {
    return fn()
  } finally {
    delete process.env.HII_TIER_FILE
  }
}

test('o arquivo real declara teto de tokens acima do maior card medido do claude', () => {
  delete process.env.HII_CARD_BUDGET_TOKENS
  const teto = G.tetoDeTokensDoCard()
  expect(teto).toBeGreaterThan(454_498)
  expect(G.motivoDeOrcamentoExcedido({ usd: 11.5517, tokens: 454_498 })).toBe('')
})

test('card de provedor sem custo em dolar para no teto de tokens', () => {
  delete process.env.HII_CARD_BUDGET_TOKENS
  const motivo = G.motivoDeOrcamentoExcedido(G.consumoDoCard({ cost_usd: '0.0000', tokens_total: '5006156' }))
  expect(motivo).toContain('limite de tokens')
})

test('o teto em dolar continua valendo antes do de tokens', () => {
  const motivo = G.motivoDeOrcamentoExcedido({ usd: 99, tokens: 10 })
  expect(motivo).toContain('limite de custo')
})

test('cost_usd corrompido nao vira gasto zero', () => {
  expect(G.motivoDeOrcamentoExcedido(G.consumoDoCard({ cost_usd: 'abc', tokens_total: '1' }))).toContain('nao e numero')
})

test('arquivo sem tetoTokens mantem o comportamento antigo: so o teto em dolar', () => {
  comArquivo({ tetoUsd: 5, acaoAoEstourar: 'pausar' }, () => {
    expect(G.tetoDeTokensDoCard()).toBe(0)
    expect(G.motivoDeTokensExcedidos(50_000_000)).toBe('')
  })
})

test('tetoTokens negativo ou de outro tipo LANCA', () => {
  comArquivo({ tetoUsd: 5, acaoAoEstourar: 'pausar', tetoTokens: -1 }, () => {
    expect(() => G.lerGovernanca()).toThrow('tetoTokens')
  })
  comArquivo({ tetoUsd: 5, acaoAoEstourar: 'pausar', tetoTokens: 'muito' }, () => {
    expect(() => G.lerGovernanca()).toThrow('tetoTokens')
  })
})

test('HII_CARD_BUDGET_TOKENS sobrepoe o arquivo', () => {
  process.env.HII_CARD_BUDGET_TOKENS = '1000'
  try {
    expect(G.tetoDeTokensDoCard()).toBe(1000)
    expect(G.motivoDeTokensExcedidos(1000)).toContain('1000 de 1000')
    expect(G.motivoDeTokensExcedidos(999)).toBe('')
  } finally {
    delete process.env.HII_CARD_BUDGET_TOKENS
  }
})
