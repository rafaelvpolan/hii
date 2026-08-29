import { isoNow } from '../../cordel/index.ts'
import { clip } from './url-guard.ts'
import type { Refusal } from './url-guard.ts'
import { patchCard } from '../../cordel/store.ts'
import type { RefOutcome } from './refs.ts'

export function refRefusalLine(source: string, refusal: Refusal): string {
  return `${isoNow()} referencia recusada: ${clip(source)} (${refusal.reason}) — ${clip(refusal.detail)} — implementando sem ela`
}

export function markRefsRefused(id: string, outcomes: RefOutcome[]): void {
  if (!id) return
  for (const o of outcomes) {
    if (o.refusal) patchCard(id, {}, refRefusalLine(o.source, o.refusal))
  }
}
