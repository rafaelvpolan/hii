import { test, expect } from '../apoio/runner.ts'
import { run } from '../../motor/quilombo/git.ts'

const SONO_DO_FILHO_S = 60
const TETO_PARA_VOLTAR_MS = 10000

test('run mata o processo no timeout (err.killed) e volta MUITO antes de o filho terminar sozinho', async () => {
  const t0 = Date.now()
  const { err } = await run('sleep', [String(SONO_DO_FILHO_S)], { timeout: 400 })
  const elapsed = Date.now() - t0
  expect(err?.killed).toBe(true)
  expect(elapsed, `voltou em ${elapsed}ms; o filho dormiria ${SONO_DO_FILHO_S * 1000}ms`).toBeLessThan(TETO_PARA_VOLTAR_MS)
}, 60000)

test('run injeta env git nao-interativo (GIT_EDITOR=true)', async () => {
  const { stdout } = await run('git', ['var', 'GIT_EDITOR'])
  expect(stdout.trim()).toBe('true')
})

test('run injeta GIT_TERMINAL_PROMPT=0', async () => {
  const { stdout } = await run('printenv', ['GIT_TERMINAL_PROMPT'])
  expect(stdout.trim()).toBe('0')
})

test('run sem timeout roda normal e sem err', async () => {
  const { err, stdout } = await run('echo', ['ok'])
  expect(err).toBeNull()
  expect(stdout.trim()).toBe('ok')
})
