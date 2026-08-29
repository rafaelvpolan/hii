import { test, expect, afterAll, beforeEach } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-fase-spec-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
process.env.HICODE_REPOS_FILE = join(BASE, 'repos.json')
mkdirSync(join(BASE, 'cards', 'runs'), { recursive: true })
const ALVO = join(BASE, 'alvo')
mkdirSync(ALVO, { recursive: true })
writeFileSync(process.env.HICODE_REPOS_FILE, JSON.stringify([{ name: 'org/app', path: ALVO, branch: 'main' }]))
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const { createCard, readCard, patchCard } = await import('../../motor/cordel/store.ts')
const { handleSpec } = await import('../../motor/niemeyer/lucio/fase-spec.ts')
import type { SpecDeps } from '../../motor/niemeyer/lucio/fase-spec.ts'

type Passo = Awaited<ReturnType<SpecDeps['runStep']>>

function passo(over: Partial<Passo> = {}): Passo {
  return { time: 1, cost: 0, costMeasured: true, tokens: 0, ok: true, text: 'ok', ...over } as Passo
}

function deps(over: Partial<SpecDeps> = {}): SpecDeps {
  return {
    ensureWorktree: async () => ({ baseCommit: 'abc1234', worktree: ALVO, branch: 'b' }),
    openspecAvailable: async () => true,
    initOpenspec: async () => true,
    runStep: async () => passo(),
    validateChange: async () => ({ ok: true, failed: 0, issues: [] }),
    ...over,
  } as SpecDeps
}

let id = ''
beforeEach(() => { id = createCard({ status: 'SPECCED', repo: 'org/app', slug: 's', title: 't' }, '## Objetivo\nfazer x\n') })

test('openspec ausente pula a fase sem gastar nada', async () => {
  await handleSpec(id, deps({ openspecAvailable: async () => false }))
  expect(readCard(id)?.fm.status).toBe('EXECUTING')
  expect(readCard(id)?.fm.spec_done).toBe('true')
})

// O retorno de runStep era descartado INTEIRO: falha do agente virava HALT dizendo
// "spec reprovado no openspec validate", causa FALSA porque o spec nunca foi gerado.
test('falha do AGENTE nao vira "spec reprovado na validacao" — o spec nunca foi gerado', async () => {
  await handleSpec(id, deps({
    runStep: async () => passo({ ok: false, text: 'timeout', failureReason: 'provedor nao respondeu' }),
    validateChange: async () => ({ ok: false, failed: 1, issues: ['spec nao gerado'] }),
  }))
  const c = readCard(id)
  expect(c?.fm.status).toBe('HALTED')
  const diario = c?.body ?? ''
  expect(diario, 'a causa tem de ser a falha do agente').toContain('o agente do spec NAO concluiu')
  expect(diario, 'nao houve validacao nenhuma para reprovar').not.toContain('reprovado no openspec validate')
  expect(diario).toContain('provedor nao respondeu')
})

test('spec reprovado DE VERDADE na validacao continua dizendo isso', async () => {
  await handleSpec(id, deps({ validateChange: async () => ({ ok: false, failed: 2, issues: ['sem MUST'] }) }))
  const c = readCard(id)
  expect(c?.fm.status).toBe('HALTED')
  expect(c?.body ?? '').toContain('reprovado no openspec validate')
})

// O custo da fase nunca era somado ao card: o gasto do spec ficava invisivel para
// tetoDoCard().
test('o custo e os tokens da fase ENTRAM no card', async () => {
  await handleSpec(id, deps({ runStep: async () => passo({ cost: 0.25, tokens: 400 }) }))
  const c = readCard(id)
  expect(c?.fm.cost_usd, 'gasto da fase invisivel para o teto por card').toBe('0.2500')
  expect(c?.fm.tokens_total).toBe('400')
})

test('o custo ACUMULA sobre o que o card ja tinha, sem sobrescrever', async () => {
  patchCard(id, { cost_usd: '1.0000', tokens_total: '100' })
  await handleSpec(id, deps({ runStep: async () => passo({ cost: 0.5, tokens: 50 }) }))
  const c = readCard(id)
  expect(c?.fm.cost_usd).toBe('1.5000')
  expect(c?.fm.tokens_total).toBe('150')
})

// `parseFloat(cost_usd || '0') || 0` fazia corrompido virar 0 — e como esta fase
// GRAVA o total de volta, isso apagaria a evidencia e desarmaria as guardas dos
// outros pontos para sempre.
test('cost_usd CORROMPIDO faz HALT em vez de virar zero e ser gravado de volta', async () => {
  patchCard(id, { cost_usd: '1,50' })
  await handleSpec(id, deps())
  const c = readCard(id)
  expect(c?.fm.status).toBe('HALTED')
  expect(c?.fm.cost_usd, 'o valor corrompido tem de PERMANECER, como evidencia').toBe('1,50')
  expect(c?.body ?? '').toContain('nao e numero')
})

test('orcamento ja estourado nao paga a fase de spec', async () => {
  const anterior = process.env.HICODE_CARD_BUDGET_USD
  process.env.HICODE_CARD_BUDGET_USD = '2'
  patchCard(id, { cost_usd: '5.0000' })
  let chamou = 0
  try {
    await handleSpec(id, deps({ runStep: async () => { chamou++; return passo() } }))
    expect(chamou, 'nao pode gastar num card que ja estourou o teto').toBe(0)
    expect(readCard(id)?.fm.status).toBe('HALTED')
    expect(readCard(id)?.body ?? '').toContain('orcamento excedido')
  } finally {
    if (anterior === undefined) delete process.env.HICODE_CARD_BUDGET_USD
    else process.env.HICODE_CARD_BUDGET_USD = anterior
  }
})

test('a fase para no meio se o laco de reajuste estourar o teto', async () => {
  const anterior = process.env.HICODE_CARD_BUDGET_USD
  process.env.HICODE_CARD_BUDGET_USD = '1'
  let chamou = 0
  try {
    await handleSpec(id, deps({
      runStep: async () => { chamou++; return passo({ cost: 0.9 }) },
      validateChange: async () => ({ ok: false, failed: 1, issues: ['de novo'] }),
    }))
    expect(chamou, 'o laco tem de parar quando o acumulado passa do teto').toBeLessThan(3)
    expect(readCard(id)?.fm.status).toBe('HALTED')
    expect(readCard(id)?.body ?? '').toContain('orcamento excedido na fase de spec')
  } finally {
    if (anterior === undefined) delete process.env.HICODE_CARD_BUDGET_USD
    else process.env.HICODE_CARD_BUDGET_USD = anterior
  }
})
