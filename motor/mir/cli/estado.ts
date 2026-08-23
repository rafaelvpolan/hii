import type { ModoNavegacao } from '../tui/input'

let itemSelecionado = ''
let modo: ModoNavegacao = ''

export function selecionado(): string {
  return itemSelecionado
}

export function selecionar(id: string): void {
  itemSelecionado = id
}

export function modoAtual(): ModoNavegacao {
  return modo
}

export function definirModo(novo: ModoNavegacao): void {
  modo = novo
}

let sessoesNaTela: string[] = []

export function sessoesVisiveis(): string[] {
  return sessoesNaTela
}

export function definirSessoesVisiveis(chaves: string[]): void {
  sessoesNaTela = chaves
}
