import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cardsDir } from '../cordel/alicerce/config.ts'
import { garantirDir } from './estado-em-disco.ts'
import { ehClasseDeFalha } from '../cordel/tipos.ts'
import type { ChamadaDeIa, IaDaSessao, PapelDeChamada, TrocaDeProvedor } from '../cordel/tipos.ts'

export type { ChamadaDeIa, IaDaSessao, PapelDeChamada, TrocaDeProvedor }

const ROTULO_DO_PAPEL: Record<PapelDeChamada, string> = {
  implement: 'executa',
  verify: 'verifica',
  gate: 'revisa',
  step: 'poli',
  clarify: 'pergunta',
  conversa: 'conversa',
  classificacao: 'leitura',
  ideacao: 'ideia',
  avaliacao: 'avalia',
  desconhecido: '?',
}

function carimbo(agoraMs: number): string {
  return new Date(agoraMs).toISOString().replace(/[^0-9]/g, '').slice(0, 14)
}

export function idDaSessao(card: string, agoraMs = Date.now()): string {
  return `${card || 'conversa'}-${carimbo(agoraMs)}`
}

export function idCurto(sessao: string): string {
  let h = 0
  for (const c of sessao) h = (h * 31 + c.charCodeAt(0)) % 0xffffffff
  return h.toString(36).padStart(4, '0').slice(-4)
}

export function arquivoDoLedger(sessao: string): string {
  return join(cardsDir(), 'runs', `${sessao}.ias.jsonl`)
}

const abertas = new Map<string, string>()

export function abrirSessao(card: string, agoraMs = Date.now()): string {
  const sessao = idDaSessao(card, agoraMs)
  abertas.set(card, sessao)
  return sessao
}

function sessaoRetomadaDoDiscoAposReinicio(card: string): string {
  const dir = join(cardsDir(), 'runs')
  if (!card || !existsSync(dir)) return ''
  const sufixo = '.ias.jsonl'
  const meus = readdirSync(dir)
    .filter(f => f.startsWith(`${card}-`) && f.endsWith(sufixo))
    .sort()
  const ultimo = meus[meus.length - 1]
  return ultimo ? ultimo.slice(0, -sufixo.length) : ''
}

export function sessaoDoCard(card: string): string {
  const guardada = abertas.get(card)
  if (guardada) return guardada
  const retomada = sessaoRetomadaDoDiscoAposReinicio(card)
  if (retomada) {
    abertas.set(card, retomada)
    return retomada
  }
  return abrirSessao(card)
}

export function esquecerSessoes(): void {
  abertas.clear()
}

export function registrarChamada(sessao: string, chamada: ChamadaDeIa): void {
  if (!sessao) return
  garantirDir(join(cardsDir(), 'runs'))
  appendFileSync(arquivoDoLedger(sessao), `${JSON.stringify(chamada)}\n`)
}

function positivo(valor: number | undefined): number {
  const n = Number(valor)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function ehPapel(valor: string): valor is PapelDeChamada {
  return Object.prototype.hasOwnProperty.call(ROTULO_DO_PAPEL, valor)
}

interface LinhaCrua {
  ts?: string
  papel?: string
  provedor?: string
  modelo?: string
  custoUsd?: number
  custoMedido?: boolean
  tokens?: number
  tokensEntrada?: number
  tokensSaida?: number
  tokensCache?: number
  duracaoS?: number
  ok?: boolean
  classeDeFalha?: string
}

function normalizar(cru: LinhaCrua): ChamadaDeIa {
  const papel = String(cru.papel ?? '')
  return {
    ts: String(cru.ts ?? ''),
    papel: ehPapel(papel) ? papel : 'desconhecido',
    provedor: String(cru.provedor ?? ''),
    modelo: String(cru.modelo ?? ''),
    custoUsd: positivo(cru.custoUsd),
    custoMedido: cru.custoMedido === true,
    tokens: positivo(cru.tokens),
    tokensEntrada: positivo(cru.tokensEntrada),
    tokensSaida: positivo(cru.tokensSaida),
    tokensCache: positivo(cru.tokensCache),
    duracaoS: positivo(cru.duracaoS),
    ok: cru.ok !== false,
    classeDeFalha: ehClasseDeFalha(cru.classeDeFalha) ? cru.classeDeFalha : '',
  }
}

export function chamadasDaSessao(sessao: string): ChamadaDeIa[] {
  const arquivo = arquivoDoLedger(sessao)
  if (!sessao || !existsSync(arquivo)) return []
  const saida: ChamadaDeIa[] = []
  for (const linha of readFileSync(arquivo, 'utf8').split('\n')) {
    if (!linha.trim()) continue
    try {
      saida.push(normalizar(JSON.parse(linha) as LinhaCrua))
    } catch {
      continue
    }
  }
  return saida
}

const ORDEM_DO_PAPEL: PapelDeChamada[] = [
  'implement', 'verify', 'gate', 'step', 'clarify', 'avaliacao', 'ideacao', 'conversa', 'classificacao', 'desconhecido',
]

function arredondar4(valor: number): number {
  return Math.round(valor * 10000) / 10000
}

export function agregarPorIa(chamadas: ChamadaDeIa[]): IaDaSessao[] {
  const mapa = new Map<string, IaDaSessao>()
  for (const c of chamadas) {
    const chave = `${c.papel}|${c.provedor}|${c.modelo}`
    const atual = mapa.get(chave) ?? {
      papel: c.papel,
      rotulo: ROTULO_DO_PAPEL[c.papel],
      provedor: c.provedor,
      modelo: c.modelo,
      custoUsd: 0,
      custoMedido: true,
      tokens: 0,
      tokensEntrada: 0,
      tokensSaida: 0,
      tokensCache: 0,
      duracaoS: 0,
      chamadas: 0,
      falhas: 0,
      classeDeFalha: '' as const,
    }
    if (c.classeDeFalha) atual.classeDeFalha = c.classeDeFalha
    atual.custoUsd += c.custoUsd
    atual.custoMedido = atual.custoMedido && c.custoMedido
    atual.tokens += c.tokens
    atual.tokensEntrada += c.tokensEntrada
    atual.tokensSaida += c.tokensSaida
    atual.tokensCache += c.tokensCache
    atual.duracaoS += c.duracaoS
    atual.chamadas += 1
    if (!c.ok) atual.falhas += 1
    mapa.set(chave, atual)
  }
  return [...mapa.values()]
    .map(i => ({ ...i, custoUsd: arredondar4(i.custoUsd) }))
    .sort((a, b) => (
      ORDEM_DO_PAPEL.indexOf(a.papel) - ORDEM_DO_PAPEL.indexOf(b.papel)
      || b.custoUsd - a.custoUsd
      || a.provedor.localeCompare(b.provedor)
    ))
}

export function trocasDeProvedor(chamadas: ChamadaDeIa[]): TrocaDeProvedor[] {
  const ultimo = new Map<PapelDeChamada, string>()
  const trocas: TrocaDeProvedor[] = []
  for (const c of chamadas) {
    if (!c.provedor) continue
    const antes = ultimo.get(c.papel)
    if (antes && antes !== c.provedor) {
      trocas.push({ papel: c.papel, rotulo: ROTULO_DO_PAPEL[c.papel], de: antes, para: c.provedor })
    }
    ultimo.set(c.papel, c.provedor)
  }
  return trocas
}

export interface ResumoDaSessao {
  sessao: string
  curto: string
  ias: IaDaSessao[]
  trocas: TrocaDeProvedor[]
  custoUsd: number
  tokens: number
  chamadas: number
}

export function resumoDaSessao(sessao: string): ResumoDaSessao {
  const chamadas = chamadasDaSessao(sessao)
  const ias = agregarPorIa(chamadas)
  return {
    sessao,
    curto: idCurto(sessao),
    ias,
    trocas: trocasDeProvedor(chamadas),
    custoUsd: arredondar4(ias.reduce((a, i) => a + i.custoUsd, 0)),
    tokens: ias.reduce((a, i) => a + i.tokens, 0),
    chamadas: chamadas.length,
  }
}
