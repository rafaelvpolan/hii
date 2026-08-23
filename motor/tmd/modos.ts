// Camada fina por cima do registro, para quem so tem o NOME do harness em maos
// (painel, CLI). Quem tem o harness usa modo-puro.ts direto — e e o que os
// adaptadores fazem, senao fechariam ciclo com o registro.
import { harnessSeExistir, modoPadraoDoProvedor, modosDoProvedor, temModos } from './registro'
import { resolverModo } from './modo-puro'
import type { HarnessId } from './tipos'

export type { CatalogoDeModo } from './tipos'
export { papelHonraModo } from './modo-puro'
export { modosDoProvedor, modoPadraoDoProvedor, temModos }

export function ehModoValido(provedor: HarnessId, modo: string | undefined): modo is string {
  return !!modo && modosDoProvedor(provedor).includes(modo)
}

export function modoResolvido(provedor: HarnessId, escolhido: string | undefined): string {
  const h = harnessSeExistir(provedor)
  return h ? resolverModo(h.modos, escolhido) : ''
}
