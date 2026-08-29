import { test, expect, lerArquivo } from '../apoio/runner.ts'

const CND = await import('../../motor/ciclo/canudos/gauntlet.ts')

test('frontend e jogos habilitam gauntlet — existe referencia de mercado comparavel', () => {
  expect(CND.gauntletVale(['common', 'frontend-web']).vale).toBe(true)
  expect(CND.gauntletVale(['common', 'games-multiplatform']).vale).toBe(true)
})

test('logica de negocio pura NAO habilita — nao existe screenshot de "comissao calculada certo"', () => {
  const v = CND.gauntletVale(['common', 'backend-web'])
  expect(v.vale).toBe(false)
  expect(v.motivo).toContain('referencia')
})

test('sem pack nenhum nao habilita — na duvida, o criterio escrito resolve mais barato', () => {
  expect(CND.gauntletVale([]).vale).toBe(false)
})

test('o dominio decide pelo pack ativo, nunca por pergunta a uma IA', async () => {
  const fonte = await lerArquivo('motor/ciclo/canudos/gauntlet.ts')
  expect(fonte, 'gatilho de dominio tem de ser deterministico').not.toContain('runProvider')
})
