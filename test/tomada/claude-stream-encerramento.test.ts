import { test, expect, beforeEach, afterEach } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeProvider } from '../../motor/tomada/harness/claude.ts'
import { parseLog } from '../../motor/mirante/atividade.ts'
import { linhaDoTempo, chamadasEmVoo } from '../../motor/euclides/linha-do-tempo.ts'

let base = ''
let env: NodeJS.ProcessEnv
beforeEach(() => {
  env = { ...process.env }
  base = mkdtempSync(join(tmpdir(), 'hii-claude-encerramento-'))
  mkdirSync(join(base, 'bin'))
  process.env.PATH = join(base, 'bin')
})
afterEach(() => { process.env = env; rmSync(base, { recursive: true, force: true }) })

for (const caso of [
  { nome: 'exit 1 sem result', script: 'echo authentication failed >&2; exit 1', fim: 'falhou', detalhe: 'authentication failed' },
  { nome: 'exit 0 sem result', script: 'echo stream incompleto; exit 0', fim: 'falhou', detalhe: 'sem evento result' },
  { nome: 'spawn ENOENT', script: '', fim: 'falhou', detalhe: 'ENOENT' },
  { nome: 'SIGTERM', script: 'kill -TERM $$', fim: 'interrompida', detalhe: 'SIGTERM' },
  { nome: 'timeout', script: 'exec /bin/sleep 60', fim: 'timeout', detalhe: 'timeout', timeoutMs: 50 },
]) test(`Claude ${caso.nome} fecha exatamente uma chamada no live log`, async () => {
  if (caso.script) writeFileSync(join(base, 'bin', 'claude'), `#!/bin/sh\n${caso.script}\n`, { mode: 0o755 })
  const liveLog = join(base, 'chamada.log')
  const resultado = await new ClaudeProvider().run({ prompt: 'teste', cwd: base, dirs: [base], mode: 'edit', useAgents: false, timeoutMs: caso.timeoutMs ?? 3000, liveLog })
  expect(resultado.ok).toBe(false)
  if (caso.nome === 'spawn ENOENT') expect(/ENOENT|executable not found/i.test(resultado.detail)).toBe(true)
  else expect(resultado.detail).toContain(caso.detalhe)
  const log = readFileSync(liveLog, 'utf8')
  const atividades = parseLog(log)
  expect(atividades.filter(a => a.tipo === 'fim').map(a => a.nome)).toEqual([caso.fim])
  expect(chamadasEmVoo(linhaDoTempo({ eventos: [], chamadas: [], atividades }))).toEqual([])
  expect(log).not.toContain('— concluido')
})

for (const isError of [false, true]) test(`Claude result repetido ${isError ? 'falhou' : 'sucesso'} nao recebe fechamento extra ao sair`, async () => {
  const evento = JSON.stringify({ type: 'result', result: isError ? 'authentication failed' : 'concluido', is_error: isError })
  writeFileSync(join(base, 'bin', 'claude'), `#!/bin/sh\nprintf '%s\\n' '${evento}' '${evento}'\nexit ${isError ? 1 : 0}\n`, { mode: 0o755 })
  const liveLog = join(base, 'chamada.log')
  const resultado = await new ClaudeProvider().run({ prompt: 'teste', cwd: base, dirs: [base], mode: 'edit', useAgents: false, timeoutMs: 3000, liveLog })
  expect(resultado.ok).toBe(!isError)
  const atividades = parseLog(readFileSync(liveLog, 'utf8'))
  expect(atividades.filter(a => a.tipo === 'fim').length).toBe(1)
  expect(chamadasEmVoo(linhaDoTempo({ eventos: [], chamadas: [], atividades }))).toEqual([])
})
