import { anexarEvento, cardFechado, cardsComDiario, eventosDoCard, ultimoEvento } from './eventos.ts'
import type { TipoDeEvento } from './eventos.ts'
import type { EventoDoCard } from './eventos.ts'

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

// Uma fase esta interrompida quando a abertura dela nao tem fechamento
// correspondente depois.
//
// A versao anterior varria de tras para frente e devolvia no PRIMEIRO evento de
// abertura que encontrava — `return fechou ? null : ...`. Isso mascarava a fase
// EXTERNA: com `fase_inicio(implement)` aberta, um `gate_start`/`gate_verdict`
// completo mais tarde fazia a varredura parar no gate, ver que ele fechou e
// responder "nada interrompido". Crash durante o reparo era relatado como
// execucao intacta, e a fase de implementacao ficava aberta no diario para
// sempre — exatamente o que esta funcao existe para impedir.
//
// A contagem tambem passou a ser por PAR: com retry, dois `fase_inicio` da mesma
// fase nao podem ser fechados pelo mesmo `fase_fim`. Cada fechamento consome uma
// abertura, e o que sobra esta aberto.
export function fasesInterrompidas(card: string): FaseInterrompida[] {
  const eventos = eventosDoCard(card)
  const abertas = new Map<string, FaseInterrompida[]>()
  for (const e of eventos) {
    if (!e) continue
    const fechamento = ABREM_FASE[e.evento]
    if (fechamento) {
      const chave = `${fechamento}:${e.fase ?? ''}`
      const pilha = abertas.get(chave) ?? []
      pilha.push({ card, fase: e.fase ?? '', evento: e, fechamento })
      abertas.set(chave, pilha)
      continue
    }
    const chave = `${e.evento}:${e.fase ?? ''}`
    const pilha = abertas.get(chave)
    if (pilha?.length) pilha.pop()
  }
  // Ordem de abertura: a fase mais EXTERNA primeiro, porque e a que o relato
  // anterior perdia.
  return [...abertas.values()].flat().sort((a, b) => String(a.evento.ts).localeCompare(String(b.evento.ts)))
}

// A fase mais EXTERNA das abertas, que e a que o relato anterior perdia. A
// producao usa `fasesInterrompidas` (plural) via retomarAoIniciar, porque precisa
// fechar todas; esta existe para consulta pontual ("este card ficou aberto?").
export function faseInterrompida(card: string): FaseInterrompida | null {
  return fasesInterrompidas(card)[0] ?? null
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
    // TODAS as fases abertas, nao so uma: se o crash pegou um reparo dentro de uma
    // implementacao, ha duas aberturas sem fechamento, e deixar uma delas de fora
    // faz o proximo arranque reportar o mesmo card de novo para sempre.
    for (const aberta of fasesInterrompidas(card)) {
      anexarEvento({
        card,
        evento: aberta.fechamento,
        fase: aberta.fase,
        detalhe: `interrompida por reinicio do motor (${aberta.evento.evento} aberto em ${aberta.evento.ts})`,
      })
      retomados.push({ card, fase: aberta.fase, desde: aberta.evento.ts })
      anotar(`[runner] #${card}: fase "${aberta.fase}" ficou aberta no crash — fechada no diario e sera reexecutada\n`)
    }
  }
  return retomados
}
