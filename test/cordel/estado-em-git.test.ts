import { test, expect } from '../apoio/runner.ts'
import { spawnSync } from 'node:child_process'

function rastreado(caminho: string): boolean {
  return spawnSync('git', ['ls-files', '--error-unmatch', caminho], { encoding: 'utf8' }).status === 0
}

// Item 31: o que e caro de reconstruir NUNCA pode existir so no disco de
// producao. Perder a VM nao pode significar perder aprendizado nem acervo.
const PRECISA_ESTAR_EM_GIT: readonly string[] = [
  'config/regras-inegociaveis.json',
  'config/review-criteria.json',
  'config/security-checklist/laravel.json',
  'config/security-checklist/typescript.json',
  'config/model-tier.json',
  'config/topologia.json',
  'config/pipeline.json',
  'config/skill-sources.json',
  'skills/_native/common/coding-standards/SKILL.md',
  'skills/_native/frontend-web/frontend-patterns/SKILL.md',
]

test('regra, criterio e acervo estao versionados — nao so no disco da maquina', () => {
  const fora = PRECISA_ESTAR_EM_GIT.filter(c => !rastreado(c))
  expect(fora, 'perder a VM nao pode significar perder aprendizado acumulado').toEqual([])
})

test('toda skill do acervo esta rastreada — skill so no disco de producao e skill que se perde', async () => {
  const { carregarAcervo } = await import('../../motor/cascudo/acervo.ts')
  const { relative } = await import('node:path')
  const fora = carregarAcervo().map(s => relative(process.cwd(), s.arquivo)).filter(c => !rastreado(c))
  expect(fora).toEqual([])
})

test('estado por card NAO e versionado — card e execucao, nao configuracao', () => {
  expect(rastreado('cards/runs/001.attempts.json'), 'diario e worktree se reconstroem; regra nao').toBe(false)
})
