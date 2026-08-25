import { AssertionError } from 'node:assert'
import { inspect } from 'node:util'

// Shim de `expect` sobre node:assert, para a suite rodar em `node --test` alem de
// `bun test`. O risco desta peca e conhecido e e o que o teste dela persegue: um
// shim PERMISSIVO deixaria a migracao inteira verde sem provar nada. Por isso
// `test/apoio/expect.test.ts` exercita cada matcher nos DOIS sentidos — passa quando
// deve passar e FALHA quando deve falhar — e `expect-diferencial.test.ts` compara o
// veredicto deste shim com o do `bun:test` caso a caso.
//
// Cobre exatamente o que a suite usa (inventariado, nao adivinhado): 25 matchers,
// `.not`, `.rejects`/`.resolves`, e a mensagem POSICIONAL de segundo argumento, que
// e extensao do Bun e nao existe no jest.

function ver(v: unknown): string {
  return inspect(v, { depth: 3, breakLength: 100, sorted: true })
}

function falhar(mensagem: string, atual: unknown, esperado: unknown, operador: string, extra?: string): never {
  throw new AssertionError({
    message: extra ? `${extra}\n${mensagem}` : mensagem,
    actual: atual,
    expected: esperado,
    operator: operador,
  })
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

// Igualdade do `toEqual`: recursiva, e IGNORA propriedade cujo valor e `undefined`
// dos dois lados — semantica do jest/bun. `assert.deepStrictEqual` do node e mais
// estrito nesse ponto (`{a: 1, b: undefined}` difere de `{a: 1}`), entao usar ele
// direto reprovaria testes que hoje passam.
// Matcher ASSIMETRICO: `expect.arrayContaining([...])` nao e um valor, e um criterio
// que o lado esperado carrega. `iguais` tem de reconhece-lo ANTES de tentar comparar
// estrutura, senao viraria uma comparacao de objeto comum e passaria/reprovaria por
// acidente. So `arrayContaining` esta aqui porque so ele e usado — inventariado.
const CRITERIO = Symbol.for('hii.expect.criterio')

interface CriterioAssimetrico {
  readonly [CRITERIO]: true
  readonly descricao: string
  casa(valor: unknown): boolean
}

function ehCriterio(v: unknown): v is CriterioAssimetrico {
  return typeof v === 'object' && v !== null && (v as Record<symbol, unknown>)[CRITERIO] === true
}

export function arrayContaining(itens: readonly unknown[]): CriterioAssimetrico {
  return {
    [CRITERIO]: true,
    descricao: `array contendo ${itens.map(i => ver(i)).join(', ')}`,
    casa: (valor) => Array.isArray(valor) && itens.every(i => valor.some(v => iguais(v, i))),
  }
}

function iguais(a: unknown, b: unknown): boolean {
  if (ehCriterio(b)) return b.casa(a)
  if (ehCriterio(a)) return a.casa(b)
  if (Object.is(a, b)) return true
  if (typeof a !== typeof b) return false
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (a instanceof RegExp && b instanceof RegExp) return a.source === b.source && a.flags === b.flags
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((v, i) => iguais(v, b[i]))
  }
  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return false
    for (const [k, v] of a) { if (!b.has(k) || !iguais(v, b.get(k))) return false }
    return true
  }
  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) return false
    for (const v of a) { if (!b.has(v)) return false }
    return true
  }
  if (!ehObjeto(a) || !ehObjeto(b)) return false
  const chaves = (o: Record<string, unknown>): string[] => Object.keys(o).filter(k => o[k] !== undefined)
  const ka = chaves(a)
  const kb = chaves(b)
  if (ka.length !== kb.length) return false
  return ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && iguais(a[k], b[k]))
}

// Subconjunto recursivo, para `toMatchObject`.
function contemObjeto(atual: unknown, esperado: unknown): boolean {
  if (!ehObjeto(esperado)) return iguais(atual, esperado)
  if (!ehObjeto(atual)) return false
  if (Array.isArray(esperado)) {
    if (!Array.isArray(atual) || atual.length !== esperado.length) return false
    return esperado.every((v, i) => contemObjeto(atual[i], v))
  }
  return Object.keys(esperado).every(k => contemObjeto(atual[k], esperado[k]))
}

function mensagemDoErro(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

function capturar(alvo: unknown): { lancou: boolean; erro: unknown } {
  if (typeof alvo !== 'function') falhar('toThrow espera uma funcao', alvo, 'function', 'toThrow')
  try {
    (alvo as () => unknown)()
    return { lancou: false, erro: undefined }
  } catch (e) {
    return { lancou: true, erro: e }
  }
}

function erroCasa(erro: unknown, criterio: unknown): boolean {
  if (criterio === undefined) return true
  if (typeof criterio === 'string') return mensagemDoErro(erro).includes(criterio)
  if (criterio instanceof RegExp) return criterio.test(mensagemDoErro(erro))
  if (typeof criterio === 'function') return erro instanceof (criterio as new () => Error)
  return false
}

function porCaminho(alvo: unknown, caminho: string): { achou: boolean; valor: unknown } {
  let atual: unknown = alvo
  for (const parte of caminho.split('.')) {
    if (!ehObjeto(atual) || !(parte in atual)) return { achou: false, valor: undefined }
    atual = atual[parte]
  }
  return { achou: true, valor: atual }
}

export interface Matchers {
  toBe(esperado: unknown): void
  toEqual(esperado: unknown): void
  toStrictEqual(esperado: unknown): void
  toContain(esperado: unknown): void
  toContainEqual(esperado: unknown): void
  toMatch(esperado: string | RegExp): void
  toMatchObject(esperado: unknown): void
  toBeTruthy(): void
  toBeFalsy(): void
  toBeNull(): void
  toBeUndefined(): void
  toBeDefined(): void
  toBeNaN(): void
  toBeGreaterThan(n: number): void
  toBeGreaterThanOrEqual(n: number): void
  toBeLessThan(n: number): void
  toBeLessThanOrEqual(n: number): void
  toBeCloseTo(n: number, digitos?: number): void
  toBeInstanceOf(classe: unknown): void
  toThrow(criterio?: unknown): void
  toThrowError(criterio?: unknown): void
  toHaveLength(n: number): void
  toHaveProperty(caminho: string, valor?: unknown): void
  toStartWith(prefixo: string): void
  toEndWith(sufixo: string): void
}

export interface Expectativa extends Matchers {
  readonly not: Matchers
  readonly rejects: PromiseMatchers
  readonly resolves: PromiseMatchers
}

export type PromiseMatchers = { [K in keyof Matchers]: (...args: Parameters<Matchers[K]>) => Promise<void> } & {
  readonly not: { [K in keyof Matchers]: (...args: Parameters<Matchers[K]>) => Promise<void> }
}

function construir(atual: unknown, msg: string | undefined, negado: boolean): Matchers {
  // Um so ponto de decisao: cada matcher entrega o veredicto POSITIVO e a
  // descricao, e daqui sai a inversao. Sem isto, `.not` seria 25 ramos duplicados —
  // e duplicacao aqui e como um shim fica permissivo em metade dos casos.
  const julgar = (passou: boolean, operador: string, descricao: string, esperado: unknown): void => {
    if (passou !== negado) return
    const nao = negado ? 'NAO ' : ''
    falhar(`esperava que ${ver(atual)} ${nao}${descricao}`, atual, esperado, operador, msg)
  }
  return {
    toBe: (e) => julgar(Object.is(atual, e), 'toBe', `fosse ${ver(e)}`, e),
    toEqual: (e) => julgar(iguais(atual, e), 'toEqual', `fosse igual a ${ver(e)}`, e),
    toStrictEqual: (e) => julgar(iguais(atual, e) && Object.getPrototypeOf(atual as object) === Object.getPrototypeOf(e as object), 'toStrictEqual', `fosse estritamente igual a ${ver(e)}`, e),
    // Igualdade ESTRITA (`===`) para array, que e a do jest e a do bun >= 1.4.0.
    //
    // Isto foi MEDIDO, e nao lido: `expect([NaN]).toContain(NaN)` PASSA no bun
    // 1.3.14 (SameValueZero, via `includes`) e FALHA no 1.4.0 (`===`, via
    // `indexOf`). O bun mudou de semantica entre minors, e a suite nao depende do
    // caso (nenhum teste usa NaN nem zero com sinal em `toContain`).
    //
    // Entre as duas, o shim segue a ESTRITA: e a do jest, e a direcao para onde o
    // bun andou. Um shim que erra para o lado permissivo e o defeito que este
    // modulo inteiro existe para nao ter.
    toContain: (e) => julgar(
      typeof atual === 'string' ? atual.includes(String(e)) : Array.isArray(atual) ? atual.some(v => v === e) : false,
      'toContain', `contivesse ${ver(e)}`, e),
    toContainEqual: (e) => julgar(Array.isArray(atual) && atual.some(v => iguais(v, e)), 'toContainEqual', `contivesse item igual a ${ver(e)}`, e),
    toMatch: (e) => julgar(typeof atual === 'string' && (typeof e === 'string' ? atual.includes(e) : e.test(atual)), 'toMatch', `casasse ${ver(e)}`, e),
    toMatchObject: (e) => julgar(contemObjeto(atual, e), 'toMatchObject', `contivesse ${ver(e)}`, e),
    toBeTruthy: () => julgar(!!atual, 'toBeTruthy', 'fosse truthy', true),
    toBeFalsy: () => julgar(!atual, 'toBeFalsy', 'fosse falsy', false),
    toBeNull: () => julgar(atual === null, 'toBeNull', 'fosse null', null),
    toBeUndefined: () => julgar(atual === undefined, 'toBeUndefined', 'fosse undefined', undefined),
    toBeDefined: () => julgar(atual !== undefined, 'toBeDefined', 'fosse definido', 'defined'),
    toBeNaN: () => julgar(typeof atual === 'number' && Number.isNaN(atual), 'toBeNaN', 'fosse NaN', NaN),
    toBeGreaterThan: (n) => julgar(typeof atual === 'number' && atual > n, 'toBeGreaterThan', `fosse > ${n}`, n),
    toBeGreaterThanOrEqual: (n) => julgar(typeof atual === 'number' && atual >= n, 'toBeGreaterThanOrEqual', `fosse >= ${n}`, n),
    toBeLessThan: (n) => julgar(typeof atual === 'number' && atual < n, 'toBeLessThan', `fosse < ${n}`, n),
    toBeLessThanOrEqual: (n) => julgar(typeof atual === 'number' && atual <= n, 'toBeLessThanOrEqual', `fosse <= ${n}`, n),
    // Regra do jest: |a-b| < 10^-digitos / 2, com 2 digitos por padrao.
    toBeCloseTo: (n, digitos = 2) => julgar(typeof atual === 'number' && Math.abs(atual - n) < Math.pow(10, -digitos) / 2, 'toBeCloseTo', `estivesse perto de ${n} (${digitos} digitos)`, n),
    toBeInstanceOf: (c) => julgar(typeof c === 'function' && atual instanceof (c as new () => unknown), 'toBeInstanceOf', `fosse instancia de ${String((c as { name?: string })?.name ?? c)}`, c),
    toThrow: (criterio) => {
      const { lancou, erro } = capturar(atual)
      julgar(lancou && erroCasa(erro, criterio), 'toThrow', criterio === undefined ? 'lancasse' : `lancasse casando ${ver(criterio)}${lancou ? ` (lancou: ${ver(mensagemDoErro(erro))})` : ' (nao lancou)'}`, criterio)
    },
    toThrowError: (criterio) => construir(atual, msg, negado).toThrow(criterio),
    toHaveLength: (n) => julgar(!!atual && typeof (atual as { length?: unknown }).length === 'number' && (atual as { length: number }).length === n, 'toHaveLength', `tivesse length ${n}`, n),
    toHaveProperty: (caminho, valor) => {
      const { achou, valor: v } = porCaminho(atual, caminho)
      julgar(achou && (valor === undefined || iguais(v, valor)), 'toHaveProperty', `tivesse "${caminho}"${valor === undefined ? '' : ` = ${ver(valor)}`}`, valor)
    },
    toStartWith: (p) => julgar(typeof atual === 'string' && atual.startsWith(p), 'toStartWith', `comecasse com ${ver(p)}`, p),
    toEndWith: (s) => julgar(typeof atual === 'string' && atual.endsWith(s), 'toEndWith', `terminasse com ${ver(s)}`, s),
  }
}

function daPromessa(alvo: unknown, msg: string | undefined, querRejeicao: boolean, negado: boolean): Record<string, unknown> {
  const chamar = async (nome: keyof Matchers, args: unknown[]): Promise<void> => {
    let valor: unknown
    let rejeitou = false
    try {
      valor = await (alvo as Promise<unknown>)
    } catch (e) {
      rejeitou = true
      valor = e
    }
    if (querRejeicao && !rejeitou) falhar('esperava que a promessa REJEITASSE, e ela resolveu', valor, 'rejeicao', 'rejects', msg)
    if (!querRejeicao && rejeitou) falhar('esperava que a promessa RESOLVESSE, e ela rejeitou', valor, 'resolucao', 'resolves', msg)
    // Em `.rejects`, o matcher recebe o ERRO. `toThrow` ali precisa de uma funcao
    // que relance — senao `capturar` reprovaria por "toThrow espera uma funcao".
    const alvoDoMatcher = querRejeicao && (nome === 'toThrow' || nome === 'toThrowError')
      ? (): never => { throw valor }
      : valor
    const m = construir(alvoDoMatcher, msg, negado) as unknown as Record<string, (...a: unknown[]) => void>
    const fn = m[nome]
    if (fn) fn(...args)
  }
  const nomes = Object.keys(construir(undefined, undefined, false)) as (keyof Matchers)[]
  const saida: Record<string, unknown> = {}
  for (const nome of nomes) saida[nome] = (...args: unknown[]) => chamar(nome, args)
  if (!negado) saida.not = daPromessa(alvo, msg, querRejeicao, true)
  return saida
}

export interface FuncaoExpect {
  (atual: unknown, msg?: string): Expectativa
  arrayContaining(itens: readonly unknown[]): CriterioAssimetrico
}

function criarExpect(atual: unknown, msg?: string): Expectativa {
  const base = construir(atual, msg, false) as Expectativa
  Object.defineProperty(base, 'not', { get: () => construir(atual, msg, true) })
  Object.defineProperty(base, 'rejects', { get: () => daPromessa(atual, msg, true, false) as unknown as PromiseMatchers })
  Object.defineProperty(base, 'resolves', { get: () => daPromessa(atual, msg, false, false) as unknown as PromiseMatchers })
  return base
}

export const expect: FuncaoExpect = Object.assign(criarExpect, { arrayContaining })
