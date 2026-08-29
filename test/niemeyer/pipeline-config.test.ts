import { test, expect } from '../apoio/runner.ts'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadPipeline, activeSteps } from '../../motor/niemeyer/config.ts'

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
  const { DEFAULT_STEPS } = await import('../../motor/niemeyer/config.ts')
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

test('REGRESSAO o pipeline default cobre testes e seguranca — nao e so um passo qualquer', async () => {
  const { DEFAULT_STEPS } = await import('../../motor/niemeyer/config.ts')
  const ids = DEFAULT_STEPS.map(s => s.id)
  for (const obrigatorio of ['testes', 'seguranca']) expect(ids).toContain(obrigatorio)
})

// DEFAULT_STEPS e apenas o FALLBACK: loadPipeline() le config/pipeline.json
// primeiro. Checar so o default deixava o arquivo que a producao usa livre para
// reganhar `review` ou ficar com `needs` apontando para id inexistente.
function integridade(steps: readonly { id: string; state: string; needs?: readonly string[] }[]): string[] {
  const ids = new Set(steps.map(s => s.id))
  const problemas: string[] = []
  if (ids.has('review')) problemas.push('o step `review` voltou: o veredito dele nunca e lido, e runCodefoxGate no fecho ja revisa LENDO o diff')
  if (steps.some(s => s.state === 'REVIEWED')) problemas.push('algum step voltou a escrever REVIEWED')
  for (const s of steps) {
    for (const dep of s.needs ?? []) if (!ids.has(dep)) problemas.push(`${s.id} depende de "${dep}", que nao existe`)
  }
  return problemas
}

test('o step `review` NAO volta, nem no default nem no config/pipeline.json que a producao le', async () => {
  const { DEFAULT_STEPS, loadPipeline } = await import('../../motor/niemeyer/config.ts')
  expect(integridade(DEFAULT_STEPS), 'DEFAULT_STEPS (fallback)').toEqual([])
  const doArquivo = loadPipeline().steps
  expect(doArquivo.length, 'loadPipeline devolveu vazio: nao ha o que verificar').toBeGreaterThan(2)
  expect(integridade(doArquivo), 'config/pipeline.json — este e o que a producao usa').toEqual([])
})

test('a checagem de integridade REPROVA de verdade — senao ela nao vigia nada', () => {
  expect(integridade([{ id: 'review', state: 'REVIEWED' }]).length).toBe(2)
  expect(integridade([{ id: 'a', state: 'REFINED', needs: ['nao-existe'] }])).toEqual([
    'a depende de "nao-existe", que nao existe',
  ])
  expect(integridade([{ id: 'a', state: 'REFINED', needs: [] }])).toEqual([])
})
