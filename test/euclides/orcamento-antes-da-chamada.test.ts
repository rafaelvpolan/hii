import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ClaudeProvider } from '../../motor/tomada/harness/claude.ts'
const dir = mkdtempSync(join(tmpdir(), 'hii-guarda-chamada-'))
process.env.HII_CARDS_DIR = dir
process.env.HII_CARD_BUDGET_USD = '5'
process.env.HII_CARD_BUDGET_TOKENS = '100'
const { createCard } = await import('../../motor/cordel/store.ts')
const { runProvider } = await import('../../motor/euclides/tesouro/confianca.ts')
afterAll(() => rmSync(dir, { recursive: true, force: true }))
test('guardas de USD e tokens barram qualquer papel antes de chamar o executor', async () => {
  const provider = new ClaudeProvider()
  let chamadas = 0
  provider.run = async () => { chamadas++; throw new Error('nao deve ser chamado') }
  for (const limites of [{ cost_usd: '5', tokens_total: '0' }, { cost_usd: '0', tokens_total: '100' }]) {
    const id = createCard({ title: 'limite', status: 'EXECUTING', ...limites }, 'Objetivo')
    const res = await runProvider(id, provider, { prompt: 'nao executar', cwd: dir, dirs: [dir], mode: 'readonly', useAgents: false, timeoutMs: 1000 }, 'gate')
    expect(res.ok).toBe(false)
    expect(res.detail).toContain('limite')
  }
  expect(chamadas).toBe(0)
})
