// ESTE ARQUIVO IMPORTA `bun:test` DE PROPOSITO, e e o unico que pode.
//
// A troca mecanica da migracao reescreveu este import para a fachada, e o teste
// passou a comparar o shim CONSIGO MESMO: quatro testes verdes provando nada. O
// vacuo que ele existe para impedir entrou por ele. O teste `os dois expect sao
// motores DIFERENTES` abaixo e a trava para isso nao acontecer de novo em silencio.
import { expect as expectDoBun } from 'bun:test'
import { test, expect } from './runner.ts'
import { expect as expectDoShim } from './expect.ts'

// O risco desta migracao, dito em PENDENCIAS.md: "a migracao inteira pode ficar verde
// por shim permissivo". Um teste que so exercita o shim contra si mesmo nao afasta
// isso — ele prova que o shim e consistente, nao que e o MESMO.
//
// Este teste compara os dois vereditos caso a caso. Se o shim aceita algo que o bun
// recusa (permissivo, o perigo) ou recusa algo que o bun aceita (estrito, quebra a
// suite), a divergencia aparece aqui com o caso concreto.

// `expect.arrayContaining` do bun e do shim sao objetos diferentes, cada um so
// entendido pelo seu motor. O caso declara o do bun; aqui ele vira o equivalente.
const ARRAY_CONTAINING: readonly (readonly unknown[])[] = [[1, 3], [9], [1]]

function trocarCriterio(a: unknown): unknown {
  const i = CRITERIOS_DO_BUN.indexOf(a)
  return i >= 0 ? expectDoShim.arrayContaining(ARRAY_CONTAINING[i] ?? []) : a
}

// Sem isto, apontar os dois lados para o mesmo motor deixaria a comparacao verde e
// vazia — foi o que aconteceu uma vez.
test('os dois expect sao motores DIFERENTES — senao a comparacao nao compara nada', () => {
  expect(expectDoBun === (expect as unknown), 'o lado "bun" foi apontado para o shim').toBe(false)
  // O do bun tem `.toBeArray`, que este shim nao implementa (a suite nao usa).
  const marca = (expectDoBun(1) as unknown as { toBeArray?: unknown }).toBeArray
  expect(typeof marca, 'o lado "bun" nao parece ser o bun:test').toBe('function')
})

// DIVERGENCIAS CONHECIDAS — casos em que o proprio `bun:test` mudou de comportamento
// entre versoes, entao ele nao serve de oraculo estavel. Nao e lista de perdao: cada
// entrada carrega a MEDICAO e a escolha, e o teto abaixo impede que ela vire deposito.
//
// Apagar o caso seria mais facil e pior: a divergencia existe, e some da vista.
const DIVERGENCIAS_CONHECIDAS: ReadonlyMap<string, string> = new Map([
  ['toContain NaN em array',
    'bun 1.3.14 passa (SameValueZero) e 1.4.0 falha (===). O shim segue a estrita, que e a do jest. Nenhum teste da suite usa NaN em toContain.'],
])

const TETO_DE_DIVERGENCIAS = 2

function veredicto(f: () => void): 'passa' | 'falha' {
  try { f(); return 'passa' } catch { return 'falha' }
}

type Caso = readonly [nome: string, atual: unknown, matcher: string, args: readonly unknown[]]

const ERRO = new TypeError('deu ruim no cofre')
const CRITERIOS_DO_BUN: readonly unknown[] = [
  expectDoBun.arrayContaining([1, 3]),
  expectDoBun.arrayContaining([9]),
  expectDoBun.arrayContaining([1]),
]

const CASOS: readonly Caso[] = [
  // toBe — identidade
  ['toBe igual', 1, 'toBe', [1]],
  ['toBe diferente', 1, 'toBe', [2]],
  ['toBe string', 'a', 'toBe', ['a']],
  ['toBe NaN', NaN, 'toBe', [NaN]],
  ['toBe zeros com sinal', -0, 'toBe', [0]],
  ['toBe objeto por referencia', { a: 1 }, 'toBe', [{ a: 1 }]],
  ['toBe undefined vs null', undefined, 'toBe', [null]],

  // toEqual — a semantica mais delicada
  ['toEqual objetos iguais', { a: 1, b: [2, 3] }, 'toEqual', [{ a: 1, b: [2, 3] }]],
  ['toEqual ordem de chave nao importa', { a: 1, b: 2 }, 'toEqual', [{ b: 2, a: 1 }]],
  ['toEqual undefined explicito vs ausente', { a: 1, b: undefined }, 'toEqual', [{ a: 1 }]],
  ['toEqual ausente vs undefined explicito', { a: 1 }, 'toEqual', [{ a: 1, b: undefined }]],
  ['toEqual aninhado diferente', { a: { b: 1 } }, 'toEqual', [{ a: { b: 2 } }]],
  ['toEqual array vs objeto', [1, 2], 'toEqual', [{ 0: 1, 1: 2 }]],
  ['toEqual arrays de tamanhos diferentes', [1, 2], 'toEqual', [[1, 2, 3]]],
  ['toEqual vazios', {}, 'toEqual', [{}]],
  ['toEqual datas iguais', new Date(5), 'toEqual', [new Date(5)]],
  ['toEqual datas diferentes', new Date(5), 'toEqual', [new Date(6)]],
  ['toEqual string vs numero', '1', 'toEqual', [1]],
  ['toEqual null vs undefined', null, 'toEqual', [undefined]],
  ['toEqual array de objetos', [{ a: 1 }], 'toEqual', [[{ a: 1 }]]],

  // toContain
  ['toContain substring', 'abcdef', 'toContain', ['cd']],
  ['toContain substring ausente', 'abcdef', 'toContain', ['xy']],
  ['toContain item de array', [1, 2, 3], 'toContain', [2]],
  ['toContain item ausente', [1, 2, 3], 'toContain', [9]],
  ['toContain NaN em array', [NaN], 'toContain', [NaN]],
  ['toContain objeto por valor (nao acha)', [{ a: 1 }], 'toContain', [{ a: 1 }]],
  ['toContain vazio em array vazio', [], 'toContain', [1]],

  // toMatch
  ['toMatch regex', 'abc123', 'toMatch', [/\d+/]],
  ['toMatch regex sem casar', 'abc', 'toMatch', [/\d+/]],
  ['toMatch string', 'abcdef', 'toMatch', ['cd']],

  // toMatchObject
  ['toMatchObject subconjunto', { a: 1, b: 2 }, 'toMatchObject', [{ a: 1 }]],
  ['toMatchObject chave a mais', { a: 1 }, 'toMatchObject', [{ a: 1, b: 2 }]],
  ['toMatchObject aninhado', { a: { b: 1, c: 2 } }, 'toMatchObject', [{ a: { b: 1 } }]],

  // numericos
  ['toBeGreaterThan verdadeiro', 5, 'toBeGreaterThan', [3]],
  ['toBeGreaterThan falso', 3, 'toBeGreaterThan', [5]],
  ['toBeGreaterThan igual', 5, 'toBeGreaterThan', [5]],
  ['toBeGreaterThanOrEqual igual', 5, 'toBeGreaterThanOrEqual', [5]],
  ['toBeLessThan verdadeiro', 3, 'toBeLessThan', [5]],
  ['toBeLessThanOrEqual igual', 5, 'toBeLessThanOrEqual', [5]],
  ['toBeCloseTo padrao dentro', 0.1 + 0.2, 'toBeCloseTo', [0.3]],
  ['toBeCloseTo padrao fora', 0.1, 'toBeCloseTo', [0.3]],
  ['toBeCloseTo com digitos', 1.234, 'toBeCloseTo', [1.235, 2]],
  ['toBeCloseTo com digitos apertados', 1.234, 'toBeCloseTo', [1.235, 5]],

  // booleanos e nulos
  ['toBeTruthy 1', 1, 'toBeTruthy', []],
  ['toBeTruthy 0', 0, 'toBeTruthy', []],
  ['toBeTruthy string vazia', '', 'toBeTruthy', []],
  ['toBeFalsy 0', 0, 'toBeFalsy', []],
  ['toBeNull null', null, 'toBeNull', []],
  ['toBeNull undefined', undefined, 'toBeNull', []],
  ['toBeUndefined undefined', undefined, 'toBeUndefined', []],
  ['toBeUndefined null', null, 'toBeUndefined', []],
  ['toBeDefined valor', 0, 'toBeDefined', []],
  ['toBeDefined undefined', undefined, 'toBeDefined', []],
  ['toBeNaN NaN', NaN, 'toBeNaN', []],
  ['toBeNaN numero', 1, 'toBeNaN', []],

  // length e property
  ['toHaveLength array', [1, 2], 'toHaveLength', [2]],
  ['toHaveLength errado', [1, 2], 'toHaveLength', [3]],
  ['toHaveLength string', 'abc', 'toHaveLength', [3]],
  ['toHaveProperty raso', { a: 1 }, 'toHaveProperty', ['a']],
  ['toHaveProperty com valor', { a: 1 }, 'toHaveProperty', ['a', 1]],
  ['toHaveProperty valor errado', { a: 1 }, 'toHaveProperty', ['a', 2]],
  ['toHaveProperty ausente', { a: 1 }, 'toHaveProperty', ['b']],
  ['toHaveProperty caminho', { a: { b: 2 } }, 'toHaveProperty', ['a.b', 2]],

  // instancia
  ['toBeInstanceOf certo', ERRO, 'toBeInstanceOf', [TypeError]],
  ['toBeInstanceOf pai', ERRO, 'toBeInstanceOf', [Error]],
  ['toBeInstanceOf errado', ERRO, 'toBeInstanceOf', [RangeError]],

  // matcher assimetrico
  ['arrayContaining subconjunto', [1, 2, 3], 'toEqual', [CRITERIOS_DO_BUN[0]]],
  ['arrayContaining item ausente', [1, 2, 3], 'toEqual', [CRITERIOS_DO_BUN[1]]],
  ['arrayContaining em nao-array', 'abc', 'toEqual', [CRITERIOS_DO_BUN[2]]],

  // strings do Bun
  ['toStartWith certo', 'abcdef', 'toStartWith', ['abc']],
  ['toStartWith errado', 'abcdef', 'toStartWith', ['bcd']],
  ['toEndWith certo', 'abcdef', 'toEndWith', ['def']],
]

const LANCADORES: readonly Caso[] = [
  ['toThrow sem criterio', () => { throw ERRO }, 'toThrow', []],
  ['toThrow que nao lanca', () => 1, 'toThrow', []],
  ['toThrow por substring', () => { throw ERRO }, 'toThrow', ['cofre']],
  ['toThrow substring ausente', () => { throw ERRO }, 'toThrow', ['banco']],
  ['toThrow por regex', () => { throw ERRO }, 'toThrow', [/deu (ruim|bom)/]],
  ['toThrow por regex sem casar', () => { throw ERRO }, 'toThrow', [/^ruim/]],
  ['toThrow por classe', () => { throw ERRO }, 'toThrow', [TypeError]],
  ['toThrow por classe errada', () => { throw ERRO }, 'toThrow', [RangeError]],
]

function aplicar(e: unknown, matcher: string, args: readonly unknown[], negado: boolean): void {
  const alvo = (negado ? (e as { not: Record<string, unknown> }).not : e) as Record<string, (...a: unknown[]) => void>
  alvo[matcher]?.(...args)
}

for (const negado of [false, true]) {
  const rotulo = negado ? '.not' : 'direto'
  test(`shim e bun dao o MESMO veredicto (${rotulo})`, () => {
    const divergentes: string[] = []
    for (const [nome, atual, matcher, args] of [...CASOS, ...LANCADORES]) {
      const doBun = veredicto(() => aplicar(expectDoBun(atual), matcher, args, negado))
      // Cada motor tem o SEU criterio assimetrico: passar o do bun para o shim (ou o
      // contrario) compararia dois formatos diferentes e daria falso positivo.
      const argsDoShim = args.map(a => trocarCriterio(a))
      const doShim = veredicto(() => aplicar(expectDoShim(atual), matcher, argsDoShim, negado))
      if (doBun !== doShim && !DIVERGENCIAS_CONHECIDAS.has(nome)) {
        divergentes.push(`${nome}: bun=${doBun} shim=${doShim}`)
      }
    }
    expect(divergentes, `divergencia entre o shim e o bun:test`).toEqual([])
  })
}

// Guarda contra o proprio teste virar vacuo: se `aplicar` errar o nome do matcher e
// nao chamar nada, os dois "passam" e a comparacao fica verde sem comparar nada.
test('o comparador NAO e vacuo — todo caso exercita os dois lados', () => {
  const semEfeito: string[] = []
  for (const [nome, atual, matcher, args] of [...CASOS, ...LANCADORES]) {
    const direto = veredicto(() => aplicar(expectDoBun(atual), matcher, args, false))
    const negado = veredicto(() => aplicar(expectDoBun(atual), matcher, args, true))
    // Um matcher que roda de verdade nunca da o mesmo veredicto nos dois sentidos.
    if (direto === negado) semEfeito.push(`${nome} (${matcher}): ${direto} nos dois sentidos`)
  }
  expect(semEfeito, 'caso que nao exercita matcher nenhum').toEqual([])
})

test('a suite de casos cobre todos os matchers que a suite de verdade usa', () => {
  const usados = new Set([...CASOS, ...LANCADORES].map(c => c[2]))
  for (const m of ['toBe', 'toEqual', 'toContain', 'toMatch', 'toMatchObject', 'toBeTruthy', 'toBeFalsy', 'toBeNull', 'toBeUndefined', 'toBeDefined', 'toBeNaN', 'toBeGreaterThan', 'toBeGreaterThanOrEqual', 'toBeLessThan', 'toBeLessThanOrEqual', 'toBeCloseTo', 'toBeInstanceOf', 'toThrow', 'toHaveLength', 'toHaveProperty', 'toStartWith', 'toEndWith']) {
    expect(usados.has(m), `matcher "${m}" sem caso diferencial`).toBe(true)
  }
})

// A lista de divergencias conhecidas nao pode rotar nem crescer sem que alguem veja.
test('a lista de divergencias conhecidas e pequena e aponta para casos que existem', () => {
  expect(DIVERGENCIAS_CONHECIDAS.size, 'divergencia demais deixa de ser excecao e vira desculpa').toBeLessThanOrEqual(TETO_DE_DIVERGENCIAS)
  const nomes = new Set([...CASOS, ...LANCADORES].map(c => c[0]))
  for (const [nome, motivo] of DIVERGENCIAS_CONHECIDAS) {
    expect(nomes.has(nome), `"${nome}" nao existe mais na lista de casos — a entrada envelheceu`).toBe(true)
    expect(motivo.length, `"${nome}" sem motivo escrito`).toBeGreaterThan(40)
  }
})
