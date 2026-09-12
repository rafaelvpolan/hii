import { test, expect, afterAll } from '../apoio/runner.ts'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AgentRequest } from '../../motor/tomada/tipos.ts'
import { parseLog } from '../../motor/mirante/atividade.ts'
import { renderExecucao } from '../../motor/mirante/render/execucao.ts'

const base = mkdtempSync(join(tmpdir(), 'hicode-codex-live-'))
const bin = join(base, 'bin')
const log = join(base, '007.live.log')
mkdirSync(bin)
writeFileSync(join(bin, 'codex'), `#!/usr/bin/env bash
if [ -p /dev/stdin ]; then printf '%s\\n' 'Reading additional input from stdin...'; fi
printf '%s\\n' '{"type":"item.completed","item":{"type":"agent_message","text":"Codex iniciou a execucao"}}'
sleep 1
printf '%s\\n' '{"type":"item.completed","item":{"type":"command_execution","command":"npm test"}}'
printf '%s\\n' '{"type":"turn.completed","usage":{"input_tokens":12,"output_tokens":4}}'
`)
chmodSync(join(bin, 'codex'), 0o755)
const pathOriginal = process.env.PATH ?? ''
process.env.PATH = `${bin}:${pathOriginal}`

const { CodexProvider } = await import('../../motor/tomada/harness/codex.ts')

afterAll(() => {
  process.env.PATH = pathOriginal
  rmSync(base, { recursive: true, force: true })
})

function pedido(): AgentRequest {
  return { prompt: 'faca algo', cwd: base, dirs: [base], mode: 'edit', useAgents: false, timeoutMs: 10000, liveLog: log, rotulo: 'implement' }
}

test('Codex grava eventos no live.log antes de a execucao terminar e a tela os enxerga', async () => {
  const promessa = new CodexProvider().run(pedido())
  let durante = ''
  for (let i = 0; i < 20; i++) {
    durante = readFileSync(log, 'utf8')
    if (durante.includes('Codex iniciou a execucao')) break
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  expect(durante).toContain('Codex iniciou a execucao')
  expect(durante).not.toContain('Reading additional input from stdin...')
  expect(durante).not.toContain('error()')
  expect(durante).not.toContain('npm test')
  const telaDurante = renderExecucao(parseLog(durante), { color: false, largura: 80 })
  expect(telaDurante).toContain('┃ Codex iniciou a execucao')

  const resultado = await promessa
  expect(resultado.ok).toBe(true)
  const final = readFileSync(log, 'utf8')
  expect(final).toContain('— concluido —')
  expect(renderExecucao(parseLog(final), { color: false, largura: 80 })).toContain('● Bash(npm test)')
})
