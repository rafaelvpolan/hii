import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { splitFrontMatter } from '../../motor/cdl'
import { allCards } from '../../motor/cdl/store'
import { cardsDir } from '../../motor/cdl/ali/config'
import { archiveDir } from '../../motor/cdl/arquivar'
import { memoChave, memoTempo } from './cache'
import { loteDesde, type RegistroDeRun } from './cota-runs'

export const JANELA_HISTORICO_MS = 7 * 24 * 60 * 60 * 1000
const TTL_MAPA_DE_REPOS_MS = 2000

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

export function idDaSessao(s: Sessao): string {
  return s.sessao || s.arquivo.replace(/\.json$/, '')
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

function repoPorCardArquivado(): Map<string, string> {
  const dir = archiveDir()
  const mapa = new Map<string, string>()
  if (!existsSync(dir)) return mapa
  for (const arquivo of readdirSync(dir)) {
    if (!arquivo.endsWith('.md')) continue
    try {
      const { fm } = splitFrontMatter(readFileSync(join(dir, arquivo), 'utf8'))
      const id = String(fm.id ?? '')
      if (id) mapa.set(id, String(fm.repo ?? ''))
    } catch {
      continue
    }
  }
  return mapa
}

function calcularMapaDeRepos(): Map<string, string> {
  const mapa = repoPorCardArquivado()
  for (const c of allCards()) mapa.set(String(c.id ?? ''), String(c.repo ?? ''))
  return mapa
}

const mapaDeReposPorDiretorio = memoChave(cardsDir, (): (() => Map<string, string>) => memoTempo(calcularMapaDeRepos, TTL_MAPA_DE_REPOS_MS))

export function repoDoCard(card: string): string {
  return card ? mapaDeReposPorDiretorio()().get(card) ?? '' : ''
}

export function historicoDeSessoes(
  limite = 0,
  janelaMs = JANELA_HISTORICO_MS,
  agoraMs = Date.now(),
  repo = '',
): HistoricoDeSessoes {
  const lote = loteDesde(agoraMs - janelaMs)
  const doProjeto = repo ? lote.registros.filter(r => repoDoCard(r.card) === repo) : lote.registros
  const naJanela = doProjeto
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
