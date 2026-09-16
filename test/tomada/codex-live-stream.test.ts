import { test, expect, afterAll } from '../apoio/runner.ts'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AgentRequest } from '../../motor/tomada/tipos.ts'
import { parseLog } from '../../motor/mirante/atividade.ts'
import { renderExecucao } from '../../motor/mirante/render/execucao.ts'
import { chamadasEmVoo, linhaDoTempo } from '../../motor/euclides/linha-do-tempo.ts'
import { renderLinhaDoTempo } from '../../motor/mirante/render/execucao.ts'
import { classifyFailure } from '../../motor/ciclo/reprise/classe-de-falha.ts'

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

for (const exitCode of [0, 1]) test(`turn.failed aninhado com exit=${exitCode} preserva cota e encerra a raia como falha`, async () => {
  writeFileSync(join(bin, 'codex'), `#!/bin/sh
printf '%s\\n' '{"type":"item.completed","item":{"type":"agent_message","text":"trabalho parcial"}}'
printf '%s\\n' '{"type":"turn.failed","error":{"message":"usage limit reached: weekly limit"}}'
exit ${exitCode}
`)
  const caminho = join(base, `falha-${exitCode}.log`)
  const provider = new CodexProvider()
  const resultado = await provider.run({ ...pedido(), liveLog: caminho, raia: 'teste 1/2' })
  expect(resultado.ok).toBe(false)
  expect(resultado.text).toContain('weekly limit')
  expect(classifyFailure(provider, resultado).failureClass).toBe('quota')
  const marcos = linhaDoTempo({ eventos: [], chamadas: [], atividades: parseLog(readFileSync(caminho, 'utf8')) })
  expect(chamadasEmVoo(marcos)).toEqual([])
  expect(marcos.length).toBe(1)
  const tela = renderLinhaDoTempo(marcos).join('\n')
  expect(tela).toContain('[teste 1/2]')
  expect(tela).toContain('weekly limit')
  expect(tela).toContain('falhou')
  expect(tela).not.toContain('concluido')
})

test('SIGTERM fecha chamada como interrompida sem despejar JSON tecnico na tela', async () => {
  writeFileSync(join(bin, 'codex'), `#!/bin/sh
printf '%s\\n' '{"type":"item.completed","item":{"type":"agent_message","text":"trabalho preservado"}}'
kill -TERM $$
`)
  const caminho = join(base, 'interrompido.log')
  const res = await new CodexProvider().run({ ...pedido(), liveLog: caminho })
  expect(res.ok).toBe(false)
  const log = readFileSync(caminho, 'utf8')
  expect(log).not.toContain('Command failed')
  expect(log).not.toContain('"item.completed"')
  const marcos = linhaDoTempo({ eventos: [], chamadas: [], atividades: parseLog(log) })
  expect(chamadasEmVoo(marcos)).toEqual([])
  const tela = renderLinhaDoTempo(marcos).join('\n')
  expect(tela).toContain('interrompida')
  expect(tela).not.toContain('falhou')
  expect(tela).not.toContain('concluido')
})
