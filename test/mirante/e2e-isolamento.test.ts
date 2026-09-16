import { test, expect } from '../apoio/runner.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ambienteTui } from './e2e/ambiente-tui.ts'

test('fixture visual substitui todo estado operacional herdado do daemon externo', () => {
  const anterior = { ...process.env }
  const base = mkdtempSync(join(tmpdir(), 'hii-isolamento-'))
  try {
    for (const nome of ['HII_RUNNER_PIDFILE', 'HII_RUNNER_LOCK', 'HII_RUNNER_LOG', 'HII_CLAUDE_HOME_DIR', 'HII_KIMI_HOME_DIR']) {
      process.env[nome] = '/estado-externo-do-usuario'
    }
    ambienteTui(base)
    for (const nome of ['HII_RUNNER_PIDFILE', 'HII_RUNNER_LOCK', 'HII_RUNNER_LOG', 'HII_CLAUDE_HOME_DIR', 'HII_KIMI_HOME_DIR']) {
      expect(process.env[nome]?.startsWith(base + '/')).toBe(true)
    }
    expect(process.env.HII_HEALTH_PORT).toBe('0')
  } finally {
    process.env = anterior
    rmSync(base, { recursive: true, force: true })
  }
})
