import { test, expect } from '../apoio/runner.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ambienteTui } from './e2e/ambiente-tui.ts'
import { profundidadeDeCor } from '../../motor/mirante/tui/paleta.ts'

test('fixture visual fixa cores mesmo herdando NO_COLOR ou terminal truecolor', () => {
  const anterior = { ...process.env }
  const base = mkdtempSync(join(tmpdir(), 'hii-cores-'))
  try {
    Object.assign(process.env, { NO_COLOR: '1', HII_COLOR_DEPTH: 'nenhuma', COLORTERM: 'truecolor' })
    ambienteTui(base)
    expect(profundidadeDeCor()).toBe('256')
    expect(process.env.NO_COLOR).toBeUndefined()
  } finally {
    process.env = anterior
    rmSync(base, { recursive: true, force: true })
  }
})

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
