import { loteDesde, type RegistroDeRun } from './cota-runs'

export const JANELA_HISTORICO_MS = 7 * 24 * 60 * 60 * 1000

export interface Sessao extends RegistroDeRun {
  posicao: number
}

export interface HistoricoDeSessoes {
  sessoes: Sessao[]
  totalNaJanela: number
  custoTotalUsd: number
  tokensTotal: number
  falhas: number
  janelaMs: number
}

export function chaveDaSessao(s: Sessao): string {
  return s.arquivo
}

export function sessaoPorChave(chave: string, h: HistoricoDeSessoes): Sessao | null {
  return h.sessoes.find(s => chaveDaSessao(s) === chave) ?? null
}

function porMaisRecente(a: RegistroDeRun, b: RegistroDeRun): number {
  return b.concluidoEmMs - a.concluidoEmMs
}

function arredondar4(valor: number): number {
  return Math.round(valor * 10000) / 10000
}

export function historicoDeSessoes(
  limite = 0,
  janelaMs = JANELA_HISTORICO_MS,
  agoraMs = Date.now(),
): HistoricoDeSessoes {
  const lote = loteDesde(agoraMs - janelaMs)
  const naJanela = lote.registros
    .filter(r => r.concluidoEmMs >= agoraMs - janelaMs)
    .sort(porMaisRecente)
  const cortados = limite > 0 ? naJanela.slice(0, limite) : naJanela
  return {
    sessoes: cortados.map((r, i) => ({ ...r, posicao: i })),
    totalNaJanela: naJanela.length,
    custoTotalUsd: arredondar4(naJanela.reduce((s, r) => s + r.custoUsd, 0)),
    tokensTotal: naJanela.reduce((s, r) => s + r.tokens, 0),
    falhas: naJanela.filter(r => !r.ok).length,
    janelaMs,
  }
}
