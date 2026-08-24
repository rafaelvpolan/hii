import { isoNow } from '../cdl/index.ts'
import type { Fields } from '../cdl/index.ts'
import { providerNames } from './registro.ts'
import { patchCardWith } from '../cdl/store.ts'

export function markProviderSubstituted(id: string, requested: string, used: string): void {
  if (!id || !requested || requested === used) return
  patchCardWith(
    id,
    (fm): Fields => (fm.provider_unknown === requested ? {} : { provider_unknown: requested }),
    fm => (fm.provider_unknown === requested
      ? ''
      : `${isoNow()} provedor "${requested}" pedido no card nao existe (provedores: ${providerNames().join(', ')}) — implementando com ${used}`),
  )
}
