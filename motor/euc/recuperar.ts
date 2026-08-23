import { cardFechado, eventosDoCard, ultimoEvento } from './eventos'
import type { EventoDoCard } from './eventos'

// EUC — retomada. No restart, o motor precisa reconstruir ONDE cada card parou
// lendo o proprio diario, em vez de assumir que tudo recomeca do zero.
//
// O erro que a Parte VI marca como mais comum: sem checkpoint, a recuperacao
// degrada para "reler o log inteiro", que e lento e caro em token. O diario por
// evento existe justamente para nao cair nisso — contanto que toda transicao
// grave o evento correspondente.

export interface FaseInterrompida {
  readonly card: string
  readonly fase: string
  readonly evento: EventoDoCard
}

const ABREM_FASE: Record<string, string> = {
  fase_inicio: 'fase_fim',
  gate_start: 'gate_verdict',
}

// Uma fase esta interrompida quando o evento de abertura nao tem o de
// fechamento correspondente depois dele.
export function faseInterrompida(card: string): FaseInterrompida | null {
  const eventos = eventosDoCard(card)
  for (let i = eventos.length - 1; i >= 0; i--) {
    const e = eventos[i]
    if (!e) continue
    const fechamento = ABREM_FASE[e.evento]
    if (!fechamento) continue
    const fechou = eventos.slice(i + 1).some(p => p.evento === fechamento && p.fase === e.fase)
    return fechou ? null : { card, fase: e.fase ?? '', evento: e }
  }
  return null
}

export function emAndamento(card: string): boolean {
  return eventosDoCard(card).length > 0 && !cardFechado(card)
}

export function ultimoPassoConhecido(card: string): string {
  const e = ultimoEvento(card)
  if (!e) return ''
  return e.fase ? `${e.evento}:${e.fase}` : e.evento
}
