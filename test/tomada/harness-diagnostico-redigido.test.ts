import { test, expect, beforeEach, afterEach } from '../apoio/runner.ts'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CodexProvider } from '../../motor/tomada/harness/codex.ts'
import { ClaudeProvider } from '../../motor/tomada/harness/claude.ts'

let base = ''
let env: NodeJS.ProcessEnv
beforeEach(() => {
  env = { ...process.env }
  base = mkdtempSync(join(tmpdir(), 'hii-harness-redigido-'))
  mkdirSync(join(base, 'bin'))
  process.env.PATH = `${join(base, 'bin')}:${process.env.PATH}`
  process.env.HII_TEST_SECRET = 'sentinela-ambiente-privada'
})
afterEach(() => { process.env = env; rmSync(base, { recursive: true, force: true }) })

for (const nome of ['codex', 'claude']) test(`${nome}: erro de CLI nao vaza credenciais em live log nem retorno direto`, async () => {
  const mensagem = 'usage limit reached; sentinela-ambiente-privada; Authorization: Bearer sentinela-bearer-privada'
  const evento = nome === 'codex'
    ? { type: 'turn.failed', error: { message: mensagem } }
    : { type: 'result', is_error: true, result: mensagem }
  const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`
  writeFileSync(join(base, 'bin', nome), `#!/bin/sh
printf '%s' 'api_key=sentinela-' >&2
printf '%s\\n' 'atribuicao-privada' >&2
printf '%s\\n' '${JSON.stringify({ api_key: 'sentinela-json-privada' })}' >&2
printf '%s\\n' 'FIM-STDERR-TECNICO' >&2
printf '%s\\n' ${quote(JSON.stringify(evento))}
exit 1
`, { mode: 0o755 })
  const liveLog = join(base, 'chamada.log')
  const harness = nome === 'codex' ? new CodexProvider() : new ClaudeProvider()
  const res = await harness.run({ prompt: 'teste', cwd: base, dirs: [base], mode: 'edit', useAgents: false, timeoutMs: 3000, liveLog })
  expect(res.ok).toBe(false)
  const log = readFileSync(liveLog, 'utf8')
  expect(log).toContain('[REDACTED]')
  expect(log).not.toContain('— concluido')
  for (const saida of [log, res.text, res.detail]) {
    for (const segredo of ['sentinela-ambiente-privada', 'sentinela-bearer-privada', 'sentinela-json-privada', 'sentinela-atribuicao-privada']) expect(saida).not.toContain(segredo)
  }
  expect(res.text).toContain('usage limit reached')
  expect(res.detail).toContain('FIM-STDERR-TECNICO')
})
