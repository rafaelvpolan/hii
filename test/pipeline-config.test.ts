import { test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadPipeline, activeSteps } from '../motor/nmy/config'

test('loadPipeline sempre devolve ao menos os steps default', () => {
  expect(loadPipeline().steps.length).toBeGreaterThan(0)
})

test('override por projeto respeita ordem e desativa steps', () => {
  const d = mkdtempSync(join(tmpdir(), 'wt-'))
  mkdirSync(join(d, '.hii'), { recursive: true })
  writeFileSync(join(d, '.hii', 'pipeline.json'), JSON.stringify({
    version: 1,
    steps: [
      { id: 'b', label: 'B', kind: 'quality', agent: 'pura', state: 'CLEANED', gate: 'none', enabled: true, instruction: 'y' },
      { id: 'a', label: 'A', kind: 'quality', agent: 'rufus', state: 'REFINED', gate: 'none', enabled: true, instruction: 'x' },
      { id: 'c', label: 'C', kind: 'quality', agent: 'crivo', state: 'REVIEWED', gate: 'none', enabled: false, instruction: 'z' },
    ],
  }))
  expect(activeSteps(d).map(s => s.label)).toEqual(['B', 'A'])
})

test('override invalido cai no default', () => {
  const d = mkdtempSync(join(tmpdir(), 'wt2-'))
  mkdirSync(join(d, '.hii'), { recursive: true })
  writeFileSync(join(d, '.hii', 'pipeline.json'), '{ nao é json valido')
  expect(loadPipeline(d).steps.length).toBeGreaterThan(0)
})

test('step com state fora do enum e descartado (cai no default)', () => {
  const d = mkdtempSync(join(tmpdir(), 'wt3-'))
  mkdirSync(join(d, '.hii'), { recursive: true })
  writeFileSync(join(d, '.hii', 'pipeline.json'), JSON.stringify({
    version: 1,
    steps: [{ id: 'x', label: 'X', kind: 'quality', agent: 'rufus', state: 'FOO', gate: 'none', enabled: true, instruction: 'z' }],
  }))
  expect(loadPipeline(d).steps.map(s => String(s.state))).not.toContain('FOO')
})

test('REGRESSAO todos os steps invalidos NAO produzem pipeline vazio — o card nao vai ao PR sem gate', async () => {
  const { DEFAULT_STEPS } = await import('../motor/nmy/config')
  const d = mkdtempSync(join(tmpdir(), 'wt4-'))
  mkdirSync(join(d, '.hii'), { recursive: true })
  writeFileSync(join(d, '.hii', 'pipeline.json'), JSON.stringify({
    version: 1,
    steps: [
      { id: 'x', label: 'X', kind: 'quality', agent: 'rufus', state: 'FOO', gate: 'none', enabled: true, instruction: 'z' },
      { id: 'y', label: 'Y', kind: 'quality', agent: 'rufus', state: 'BAR', gate: 'none', enabled: true, instruction: 'z' },
    ],
  }))
  const steps = loadPipeline(d).steps
  expect(steps.length).toBeGreaterThan(0)
  expect(steps.map(s => s.id)).toEqual(DEFAULT_STEPS.map(s => s.id))
})

test('REGRESSAO o pipeline default cobre testes, seguranca e review — nao e so um passo qualquer', async () => {
  const { DEFAULT_STEPS } = await import('../motor/nmy/config')
  const ids = DEFAULT_STEPS.map(s => s.id)
  for (const obrigatorio of ['testes', 'seguranca', 'review']) expect(ids).toContain(obrigatorio)
})
