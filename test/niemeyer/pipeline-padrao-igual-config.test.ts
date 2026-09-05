// DEFAULT_STEPS duplica config/pipeline.json por desenho (e o fallback quando o
// JSON esta ilegivel) — mas nada travava a igualdade, e a copia de codigo vence
// exatamente na hora em que ninguem ve (raio-x, item 23). Duas fontes para o
// mesmo dado so sao aceitaveis se um teste as obrigar a contar a mesma historia.
import { test, expect, lerArquivo } from '../apoio/runner.ts'
import type { PipelineStep } from '../../motor/niemeyer/tipos.ts'

const { DEFAULT_STEPS } = await import('../../motor/niemeyer/config.ts')

test('o fallback embutido e IDENTICO ao config/pipeline.json versionado', async () => {
  const doDisco = JSON.parse(await lerArquivo('config/pipeline.json')) as { steps: PipelineStep[] }
  expect(DEFAULT_STEPS).toEqual(doDisco.steps)
})
