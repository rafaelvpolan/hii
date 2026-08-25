import { test as testeDoNode, before, after, beforeEach as antesDeCada, afterEach as depoisDeCada } from 'node:test'

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

export type FuncaoDeTeste = () => void | Promise<void>

export function test(nome: string, fn: FuncaoDeTeste, timeoutMs?: number): void {
  if (timeoutMs === undefined) { void testeDoNode(nome, () => fn()); return }
  void testeDoNode(nome, { timeout: timeoutMs }, () => fn())
}

export const it = test

export function beforeAll(fn: FuncaoDeTeste): void { before(() => fn()) }
export function afterAll(fn: FuncaoDeTeste): void { after(() => fn()) }
export function beforeEach(fn: FuncaoDeTeste): void { antesDeCada(() => fn()) }
export function afterEach(fn: FuncaoDeTeste): void { depoisDeCada(() => fn()) }
