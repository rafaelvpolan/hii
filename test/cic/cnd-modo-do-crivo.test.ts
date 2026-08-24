import { test, expect } from 'bun:test'

const CND = await import('../../motor/cic/cnd/gauntlet.ts')

const PACKS_FRONT = ['common', 'frontend-web']
const REF = ['/cards/refs/042/ref-1.png']

test('frontend com referencia anexada entra em gauntlet', () => {
  const m = CND.modoDoCrivo({ packs: PACKS_FRONT, referencias: REF })
  expect(m.modo).toBe('gauntlet')
})

test('SEM referencia anexada volta ao criterio escrito — sem referencia nao existe comparacao cega', () => {
  const m = CND.modoDoCrivo({ packs: PACKS_FRONT, referencias: [] })
  expect(m.modo).toBe('criterio-escrito')
  expect(m.motivo).toContain('referencia')
})

test('dominio de logica pura fica no criterio escrito mesmo com imagem anexada', () => {
  const m = CND.modoDoCrivo({ packs: ['common', 'backend-web'], referencias: REF })
  expect(m.modo).toBe('criterio-escrito')
})

test('BOUNDARY sem teto legivel nao entra em gauntlet, mesmo com dominio e referencia', () => {
  const m = CND.modoDoCrivo({ packs: PACKS_FRONT, referencias: REF, permissao: { pode: false, tetoUsd: 0, motivo: 'teto ilegivel' } })
  expect(m.modo).toBe('criterio-escrito')
  expect(m.motivo).toContain('teto')
})

test('o motivo sempre explica a escolha — modo sem porque nao se audita', () => {
  for (const caso of [
    { packs: PACKS_FRONT, referencias: REF },
    { packs: PACKS_FRONT, referencias: [] },
    { packs: ['common'], referencias: REF },
  ]) {
    expect(CND.modoDoCrivo(caso).motivo.length).toBeGreaterThan(10)
  }
})

test('INVARIANTE o crivo escolhe o modo e registra no card', async () => {
  const fonte = await Bun.file('motor/cic/crv/gate.ts').text()
  expect(fonte).toContain('modoDoCrivo(')
  expect(fonte, 'o gauntlet compara imagem contra imagem, nao diff contra imagem').toContain('renderizarComparacao(')
})
