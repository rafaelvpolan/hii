import { allCards } from '../../cdl/store'
import { eventosDoCard } from '../eventos'
import { maxReajuste } from '../../cdl/ali/config'
import { MAX_CONFLICT } from '../../cdl/ali/config'

// TSR — medir antes de automatizar.
//
// A pergunta que isto responde e "quais alvos consomem reparo demais", que e o
// insumo que faltava para decidir baixar HICODE_REAJUSTE_RETRIES ou
// HICODE_CONFLICT_RETRIES para um alvo especifico.
//
// Nao existe detector automatico de propósito: um limiar automatico precisaria
// de politica de decaimento e armazenamento, e ainda seria proxy para "isto esta
// custando demais" — que o orcamentoPorCard mede direto. Aqui o motor mostra o
// numero e a decisao segue humana.
//
// A media por card e o numero que decide, nao o total: um alvo com 50 cards e 50
// reparos esta saudavel; um com 2 cards e 10 reparos nao esta.

export interface InstabilidadeDoAlvo {
  readonly alvo: string
  readonly cards: number
  readonly tentativas: number
  readonly mediaPorCard: number
  readonly porFase: Readonly<Record<string, number>>
}

export function instabilidadePorAlvo(): InstabilidadeDoAlvo[] {
  const porAlvo = new Map<string, { cards: Set<string>; tentativas: number; porFase: Record<string, number> }>()
  for (const card of allCards()) {
    const id = card.id ?? ''
    const alvo = card.repo ?? ''
    if (!id || !alvo) continue
    const reparos = eventosDoCard(id).filter(e => e.evento === 'repair_attempt')
    if (!reparos.length) continue
    const atual = porAlvo.get(alvo) ?? { cards: new Set<string>(), tentativas: 0, porFase: {} }
    atual.cards.add(id)
    atual.tentativas += reparos.length
    for (const r of reparos) {
      const fase = r.fase ?? 'sem-fase'
      atual.porFase[fase] = (atual.porFase[fase] ?? 0) + 1
    }
    porAlvo.set(alvo, atual)
  }
  return [...porAlvo.entries()]
    .map(([alvo, v]) => ({
      alvo,
      cards: v.cards.size,
      tentativas: v.tentativas,
      mediaPorCard: v.tentativas / v.cards.size,
      porFase: v.porFase,
    }))
    .sort((a, b) => b.mediaPorCard - a.mediaPorCard || a.alvo.localeCompare(b.alvo))
}

export function relatoDeInstabilidade(medidas: readonly InstabilidadeDoAlvo[]): string {
  if (!medidas.length) return 'reparo por alvo: nenhuma tentativa registrada'
  const linhas = medidas.map(m => {
    const fases = Object.entries(m.porFase).sort(([a], [b]) => a.localeCompare(b)).map(([f, n]) => `${f}=${n}`).join(' ')
    return `  ${m.alvo}: ${m.mediaPorCard.toFixed(1)} reparo(s)/card em ${m.cards} card(s) — ${fases}`
  })
  return [
    `reparo por alvo (tetos vigentes: HICODE_REAJUSTE_RETRIES=${maxReajuste()} HICODE_CONFLICT_RETRIES=${MAX_CONFLICT}):`,
    ...linhas,
  ].join('\n')
}
