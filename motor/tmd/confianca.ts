import { isoNow } from '../cdl'
import type { Fields } from '../cdl'
import { providerNames } from './registro'
import { patchCardWith } from '../cdl/store'

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
