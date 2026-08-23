import type { AgentRole, CatalogoDeModo } from './tipos'

// Puro e sem dependencia do registro, de proposito: os adaptadores em
// harness/ precisam resolver o proprio modo, e importar o registro dali
// fecharia ciclo (registro -> harness -> registro).
export function ehModoValido(catalogo: CatalogoDeModo, modo: string | undefined): modo is string {
  return !!modo && catalogo.modos.includes(modo)
}

export function resolverModo(catalogo: CatalogoDeModo, escolhido: string | undefined): string {
  return ehModoValido(catalogo, escolhido) ? escolhido : catalogo.padrao
}

const PAPEIS_QUE_EDITAM: readonly AgentRole[] = ['implement', 'step']

export function papelHonraModo(papel: AgentRole): boolean {
  return PAPEIS_QUE_EDITAM.includes(papel)
}
