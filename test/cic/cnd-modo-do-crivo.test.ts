import { test, expect, lerArquivo } from '../apoio/runner.ts'

const CND = await import('../../motor/cic/cnd/gauntlet.ts')

const PACKS_FRONT = ['common', 'frontend-web']
const REF = ['/cards/refs/042/ref-1.png']

// `ativado` e o interruptor do humano (`/gauntlet on`). Sem ele o modo nao entra —
// os casos abaixo testam o que acontece DEPOIS de ligado.
const LIGADO = { ativado: true }

test('frontend com referencia anexada entra em gauntlet', () => {
  const m = CND.modoDoCrivo({ packs: PACKS_FRONT, referencias: REF, ...LIGADO })
  expect(m.modo).toBe('gauntlet')
})

test('SEM referencia anexada volta ao criterio escrito — sem referencia nao existe comparacao cega', () => {
  const m = CND.modoDoCrivo({ packs: PACKS_FRONT, referencias: [], ...LIGADO })
  expect(m.modo).toBe('criterio-escrito')
  expect(m.motivo).toContain('referencia')
})

test('dominio de logica pura fica no criterio escrito mesmo com imagem anexada', () => {
  const m = CND.modoDoCrivo({ packs: ['common', 'backend-web'], referencias: REF, ...LIGADO })
  expect(m.modo).toBe('criterio-escrito')
})

test('BOUNDARY sem teto legivel nao entra em gauntlet, mesmo com dominio e referencia', () => {
  const m = CND.modoDoCrivo({ packs: PACKS_FRONT, referencias: REF, ...LIGADO, permissao: { pode: false, tetoUsd: 0, motivo: 'teto ilegivel' } })
  expect(m.modo).toBe('criterio-escrito')
  expect(m.motivo).toContain('teto')
})

test('o motivo sempre explica a escolha — modo sem porque nao se audita', () => {
  for (const caso of [
    { packs: PACKS_FRONT, referencias: REF, ...LIGADO },
    { packs: PACKS_FRONT, referencias: [], ...LIGADO },
    { packs: ['common'], referencias: REF, ...LIGADO },
    { packs: PACKS_FRONT, referencias: REF },
  ]) {
    expect(CND.modoDoCrivo(caso).motivo.length).toBeGreaterThan(10)
  }
})

test('INVARIANTE o crivo escolhe o modo e registra no card', async () => {
  const fonte = await lerArquivo('motor/cic/crv/gate.ts')
  expect(fonte).toContain('modoDoCrivo(')
  expect(fonte, 'o gauntlet compara imagem contra imagem, nao diff contra imagem').toContain('renderizarComparacao(')
})

test('DESLIGADO por omissao: dominio e referencia nao bastam — o gauntlet e escolha explicita do humano', () => {
  const m = CND.modoDoCrivo({ packs: PACKS_FRONT, referencias: REF })
  expect(m.modo, 'ligado por heuristica, um card de front com imagem anexada saia sem NENHUMA leitura de codigo').toBe('criterio-escrito')
  expect(m.motivo).toContain('/gauntlet on')
})

test('ativado: false e o mesmo que desligado — nao existe meio-ligado', () => {
  expect(CND.modoDoCrivo({ packs: PACKS_FRONT, referencias: REF, ativado: false }).modo).toBe('criterio-escrito')
})

test('TETO APLICADO: card que ja gastou o teto nao entra em gauntlet, mesmo ligado e com tudo no lugar', () => {
  const permissao = { pode: true, tetoUsd: 16, motivo: 'teto de US$16 por card' }
  const acima = CND.modoDoCrivo({ packs: PACKS_FRONT, referencias: REF, ...LIGADO, permissao, gastoUsd: 16 })
  expect(acima.modo, 'ler o teto e nao compara-lo com o gasto e teto decorativo').toBe('criterio-escrito')
  expect(acima.motivo).toContain('16')
  const abaixo = CND.modoDoCrivo({ packs: PACKS_FRONT, referencias: REF, ...LIGADO, permissao, gastoUsd: 1.5 })
  expect(abaixo.modo).toBe('gauntlet')
})

test('gasto desconhecido nao inventa bloqueio — sem numero nao ha comparacao com o teto', () => {
  const permissao = { pode: true, tetoUsd: 16, motivo: 'teto de US$16 por card' }
  expect(CND.modoDoCrivo({ packs: PACKS_FRONT, referencias: REF, ...LIGADO, permissao }).modo).toBe('gauntlet')
})

// `null` de gastoDoCard e CORROMPIDO, nao "nao sei". Mapear os dois para
// `undefined` fazia a trava nem comparar, e o modo caro iniciava exatamente quando
// o registro de custo esta quebrado — fail-open num portao de gasto.
test('TETO gasto CORROMPIDO barra o gauntlet, nao vira "gasto desconhecido"', async () => {
  const permissao = { pode: true, tetoUsd: 16, motivo: 'teto de US$16 por card' }
  const corrompido = CND.modoDoCrivo({
    packs: PACKS_FRONT, referencias: REF, ...LIGADO, permissao,
    gastoUsd: Number.POSITIVE_INFINITY,
  })
  expect(corrompido.modo, 'registro de custo quebrado nao pode liberar chamada de visao paga').toBe('criterio-escrito')
  expect(corrompido.motivo).toContain('teto')
})

test('INVARIANTE o gate converte cost_usd corrompido em barreira, nao em undefined', async () => {
  const fonte = await lerArquivo('motor/cic/crv/gate.ts')
  expect(fonte, 'gastoDoCard(...) ?? undefined apaga a distincao entre corrompido e desconhecido')
    .not.toContain('gastoDoCard(card.fm.cost_usd) ?? undefined')
  expect(fonte).toContain('Number.POSITIVE_INFINITY')
})

test('MAX_CANDIDATOS_CEGOS e derivado dos rotulos, nao copiado', () => {
  expect(CND.MAX_CANDIDATOS_CEGOS).toBe(8)
  const candidatos = Array.from({ length: CND.MAX_CANDIDATOS_CEGOS }, (_, i) => ({ origem: `o${i}`, conteudo: `c${i}` }))
  expect(() => CND.cegar(candidatos, 'x'), 'exatamente o maximo tem de passar').not.toThrow()
  expect(() => CND.cegar([...candidatos, { origem: 'extra', conteudo: 'c' }], 'x')).toThrow('ate 8')
})
