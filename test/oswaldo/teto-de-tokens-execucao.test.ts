import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ExecuteDeps } from '../../motor/oswaldo/executar.ts'

const BASE = mkdtempSync(join(tmpdir(), 'hii-teto-tokens-exec-'))
process.env.HII_CARDS_DIR = join(BASE, 'cards')
mkdirSync(process.env.HII_CARDS_DIR, { recursive: true })
process.env.HII_REPOS_FILE = join(BASE, 'repos.json')
writeFileSync(process.env.HII_REPOS_FILE, JSON.stringify([{ name: 'org/repo', path: join(BASE, 'clone'), branch: 'main' }]))
process.env.HII_CARD_BUDGET_TOKENS = '1000'

afterAll(() => {
  delete process.env.HII_CARD_BUDGET_TOKENS
  rmSync(BASE, { recursive: true, force: true })
})

const { createCard, readCard } = await import('../../motor/cordel/store.ts')
const { handleExecute } = await import('../../motor/oswaldo/executar.ts')
const { executarGateway } = await import('../../motor/oswaldo/gateway.ts')

let chamadas = 0
const naoDeveChamar: ExecuteDeps = {
  implement: () => { chamadas++; return Promise.reject(new Error('o teto deveria ter parado antes da chamada paga')) },
  verifyVisual: () => Promise.reject(new Error('nao deveria verificar')),
}

test('execucao com tokens acima do teto para em HALTED orcamento sem chamar a IA', async () => {
  const id = createCard({ title: 'card codex caro', repo: 'org/repo', status: 'EXECUTING', cost_usd: '0.0000', tokens_total: '5006156', cost_unverified: 'codex' }, 'corpo')
  await handleExecute(id, naoDeveChamar)
  const fm = readCard(id)?.fm
  expect(chamadas).toBe(0)
  expect(fm?.status).toBe('HALTED')
  expect(fm?.halt_class).toBe('orcamento')
  expect(fm?.halt_reason).toContain('limite de tokens')
})

test('gateway com tokens acima do teto para em HALTED orcamento sem chamar a IA', async () => {
  mkdirSync(join(BASE, 'clone'), { recursive: true })
  const id = createCard({ title: 'gateway caro', repo: 'org/repo', status: 'EXECUTING', cost_usd: '0', tokens_total: '2000' }, 'corpo')
  let chamou = false
  await executarGateway(id, {
    chamar: () => { chamou = true; return Promise.reject(new Error('nao deveria chamar')) },
    rota: () => ({ acao: 'manter_politica_atual', motivo: '' }),
  })
  const fm = readCard(id)?.fm
  expect(chamou).toBe(false)
  expect(fm?.status).toBe('HALTED')
  expect(fm?.halt_class).toBe('orcamento')
  expect(fm?.halt_reason).toContain('limite de tokens')
})
