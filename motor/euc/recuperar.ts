import { anexarEvento, cardFechado, cardsComDiario, eventosDoCard, ultimoEvento } from './eventos'
import type { TipoDeEvento } from './eventos'
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
  // Qual evento fecha ESTE tipo de abertura. gate_start pede gate_verdict, nao
  // fase_fim — fechar com o evento errado deixa a fase aberta para sempre.
  readonly fechamento: TipoDeEvento
}

const ABREM_FASE: Record<string, TipoDeEvento> = {
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
    return fechou ? null : { card, fase: e.fase ?? '', evento: e, fechamento }
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

export interface RetomadaDeCard {
  readonly card: string
  readonly fase: string
  readonly desde: string
}

// Chamado no arranque do daemon, DEPOIS de reconcileStranded. Os dois se
// complementam e nao se substituem: reconcileStranded olha o STATUS do card e
// decide para onde ele volta; isto olha o DIARIO e fecha a fase que ficou
// aberta no ar quando o processo morreu.
//
// Sem isto, faseInterrompida() reportaria a mesma fase como interrompida para
// sempre, e o rastro nao registraria que houve corte — o `aprendiz` (item 12)
// leria uma execucao que "nunca terminou" em vez de uma que foi interrompida.
export function retomarAoIniciar(anotar: (linha: string) => void = () => undefined): RetomadaDeCard[] {
  const retomados: RetomadaDeCard[] = []
  for (const card of cardsComDiario()) {
    if (cardFechado(card)) continue
    const aberta = faseInterrompida(card)
    if (!aberta) continue
    anexarEvento({
      card,
      evento: aberta.fechamento,
      fase: aberta.fase,
      detalhe: `interrompida por reinicio do motor (${aberta.evento.evento} aberto em ${aberta.evento.ts})`,
    })
    retomados.push({ card, fase: aberta.fase, desde: aberta.evento.ts })
    anotar(`[runner] #${card}: fase "${aberta.fase}" ficou aberta no crash — fechada no diario e sera reexecutada\n`)
  }
  return retomados
}
