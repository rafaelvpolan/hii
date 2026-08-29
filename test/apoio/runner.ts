export { expect } from './expect.ts'
export { lerArquivo, dormir, qualBinario, rodar, servidorDeTeste } from './bun.ts'

// Fachada com os nomes que a suite ja usa, para a troca mecanica ser um `sed` de
// import e nada mais. Tres diferencas reais entre `bun:test` e `node:test`, todas
// absorvidas aqui:
//
// 1. O TIMEOUT e posicional no bun (`test(nome, fn, 30000)`) e opcao no node
//    (`test(nome, { timeout }, fn)`). A suite usa a forma posicional em dezenas de
//    lugares (TEMPO_COM_GIT_MS); traduzir aqui evita tocar em cada chamada.
// 2. `afterAll`/`beforeAll` se chamam `after`/`before` no node.
// 3. O node passa um contexto para a funcao do teste; a suite nao usa, e receber um
//    argumento a mais nao muda nada — mas a assinatura fica explicita.
//
// POR QUE A ESCOLHA E EM TEMPO DE EXECUCAO, e nao um import fixo de `node:test`:
// enquanto este arquivo importava `node:test` incondicionalmente, rodar sob
// `bun test` usava o SHIM de node:test do Bun, e nao o runner nativo. O shim tem a
// guarda `checkNotInsideTest`, que proibe registrar teste enquanto outro roda. E
// 140 dos 248 arquivos da suite fazem `await import(...)` no topo: o modulo
// suspende, o runner comeca a rodar o que ja registrou, e quando o modulo volta
// para chamar `test()` a guarda dispara. Resultado medido em 28/08/2026: 125 erros
// e so 1566 dos 2704 testes rodando sob `bun test`, contra 2704/0 sob `node --test`.
// O runner nativo de cada plataforma nao tem esse conflito — falta era escolher.

interface RegistradorDeTeste {
  (nome: string, fn: () => void | Promise<void>): unknown
  (nome: string, opcoes: { timeout: number }, fn: () => void | Promise<void>): unknown
}

interface GanchoDeTeste {
  (fn: () => void | Promise<void>): unknown
}

interface ApiDeTeste {
  test: RegistradorDeTeste
  beforeAll: GanchoDeTeste
  afterAll: GanchoDeTeste
  beforeEach: GanchoDeTeste
  afterEach: GanchoDeTeste
  timeoutPosicional: boolean
}

function rodandoSobBun(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'
}

async function carregarApi(): Promise<ApiDeTeste> {
  if (rodandoSobBun()) {
    const bun = await import('bun:test')
    return {
      test: bun.test as unknown as RegistradorDeTeste,
      beforeAll: bun.beforeAll as unknown as GanchoDeTeste,
      afterAll: bun.afterAll as unknown as GanchoDeTeste,
      beforeEach: bun.beforeEach as unknown as GanchoDeTeste,
      afterEach: bun.afterEach as unknown as GanchoDeTeste,
      timeoutPosicional: true,
    }
  }
  const no = await import('node:test')
  return {
    test: no.test as unknown as RegistradorDeTeste,
    beforeAll: no.before as unknown as GanchoDeTeste,
    afterAll: no.after as unknown as GanchoDeTeste,
    beforeEach: no.beforeEach as unknown as GanchoDeTeste,
    afterEach: no.afterEach as unknown as GanchoDeTeste,
    timeoutPosicional: false,
  }
}

const api = await carregarApi()

export type FuncaoDeTeste = () => void | Promise<void>

export function test(nome: string, fn: FuncaoDeTeste, timeoutMs?: number): void {
  if (timeoutMs === undefined) { void api.test(nome, () => fn()); return }
  // O bun so aceita o timeout como TERCEIRO argumento posicional; o node so aceita
  // como opcao no segundo. Passar a forma errada nao lanca — o timeout so e
  // ignorado em silencio, e o teste que devia parar em 60s roda ate o teto do
  // runner. Por isso a distincao e explicita e nao "passa os dois e torce".
  if (api.timeoutPosicional) {
    void (api.test as unknown as (n: string, f: FuncaoDeTeste, t: number) => unknown)(nome, () => fn(), timeoutMs)
    return
  }
  void api.test(nome, { timeout: timeoutMs }, () => fn())
}

export const it = test

export function beforeAll(fn: FuncaoDeTeste): void { api.beforeAll(() => fn()) }
export function afterAll(fn: FuncaoDeTeste): void { api.afterAll(() => fn()) }
export function beforeEach(fn: FuncaoDeTeste): void { api.beforeEach(() => fn()) }
export function afterEach(fn: FuncaoDeTeste): void { api.afterEach(() => fn()) }
