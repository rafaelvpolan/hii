import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { FailureClass, IaDaSessao, TrocaDeProvedor } from '../../cdl'
import { cardsDir } from '../../cdl/ali/config'
import { memoArquivo, memoChave, memoTempo } from '../../tmd/eco/memo'

function ttlListagemMs(): number {
  return Number(process.env.HICODE_COTA_TTL_MS ?? '2000')
}

export const PROVEDOR_DESCONHECIDO = 'desconhecido'
export const JANELA_COTA_MS = 4 * 60 * 60 * 1000


const FOLGA_DO_NOME_MS = 60_000
const RE_ARQUIVO_DE_RUN = /^(\d+)-(\d{14})\.json$/
const RE_ARQUIVO_DE_CONVERSA = /^conversa-(\d{14})-\d+\.json$/

export function ehArquivoDeSessao(nome: string): boolean {
  return RE_ARQUIVO_DE_RUN.test(nome) || RE_ARQUIVO_DE_CONVERSA.test(nome)
}

function digitosDoNome(nome: string): string {
  return RE_ARQUIVO_DE_RUN.exec(nome)?.[2] ?? RE_ARQUIVO_DE_CONVERSA.exec(nome)?.[1] ?? ''
}

export interface RegistroDeRun {
  arquivo: string
  card: string
  concluidoEm: string
  concluidoEmMs: number
  ok: boolean
  custoUsd: number
  tokens: number
  tokensEntrada: number
  tokensSaida: number
  tokensCache: number
  duracaoS: number
  provedor: string
  provedorIdentificado: boolean
  modelo: string
  classeDeFalha: FailureClass | ''
  motivoDaFalha: string
  sessao: string
  tipo: 'execucao' | 'conversa'
  ias: IaDaSessao[]
  trocas: TrocaDeProvedor[]
}

export interface LoteDeRuns {
  registros: RegistroDeRun[]
  ignorados: number
  desdeMs: number
}

interface RunEmDisco {
  id?: string
  ts?: string
  ok?: boolean
  cost_usd?: string
  duration_s?: number
  tokens_total?: number
  tokens_in?: number
  tokens_out?: number
  tokens_cache_create?: number
  provider?: string
  model?: string
  failure_class?: string
  failure_reason?: string
  session?: string
  kind?: 'execucao' | 'conversa'
  ias?: IaDaSessao[]
  trocas?: TrocaDeProvedor[]
}

const CLASSES_DE_FALHA: readonly FailureClass[] = ['transient', 'quota', 'terminal']

function runsDir(): string {
  return join(cardsDir(), 'runs')
}

export function instanteDoNome(nome: string): number {
  const digitos = digitosDoNome(nome)
  if (!digitos) return Number.NaN
  const d = digitos
  return Date.parse(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(8, 10)}:${d.slice(10, 12)}:${d.slice(12, 14)}Z`)
}

interface TokensPorTipo {
  entrada: number
  saida: number
  cache: number
}

function tokensPorTipoDe(bruto: RunEmDisco): TokensPorTipo {
  return {
    entrada: Number(bruto.tokens_in) || 0,
    saida: Number(bruto.tokens_out) || 0,
    cache: Number(bruto.tokens_cache_create) || 0,
  }
}

function tokensDe(bruto: RunEmDisco, porTipo: TokensPorTipo): number {
  const total = Number(bruto.tokens_total) || 0
  if (total > 0) return total
  return porTipo.entrada + porTipo.saida + porTipo.cache
}

function classeDeFalhaDe(bruto: string | undefined, ok: boolean): FailureClass | '' {
  if (ok) return ''
  return CLASSES_DE_FALHA.find(c => c === bruto) ?? ''
}

function instanteDoRegistro(bruto: RunEmDisco, nome: string): number {
  const carimbo = Date.parse(String(bruto.ts ?? ''))
  return Number.isFinite(carimbo) ? carimbo : instanteDoNome(nome)
}

function normalizar(caminho: string, bruto: RunEmDisco): RegistroDeRun | null {
  const nome = basename(caminho)
  const quando = instanteDoRegistro(bruto, nome)
  if (!Number.isFinite(quando)) return null
  const provedor = String(bruto.provider ?? '').trim()
  const ok = bruto.ok === true
  const porTipo = tokensPorTipoDe(bruto)
  return {
    arquivo: nome,
    card: String(bruto.id ?? ''),
    concluidoEm: new Date(quando).toISOString().replace(/\.\d+Z$/, 'Z'),
    concluidoEmMs: quando,
    ok,
    custoUsd: parseFloat(String(bruto.cost_usd ?? '')) || 0,
    duracaoS: Number(bruto.duration_s) || 0,
    tokens: tokensDe(bruto, porTipo),
    tokensEntrada: porTipo.entrada,
    tokensSaida: porTipo.saida,
    tokensCache: porTipo.cache,
    provedor: provedor || PROVEDOR_DESCONHECIDO,
    provedorIdentificado: provedor !== '',
    modelo: String(bruto.model ?? '').trim(),
    classeDeFalha: classeDeFalhaDe(bruto.failure_class, ok),
    motivoDaFalha: ok ? '' : String(bruto.failure_reason ?? ''),
    sessao: String(bruto.session ?? ''),
    tipo: bruto.kind === 'conversa' ? 'conversa' : 'execucao',
    ias: Array.isArray(bruto.ias) ? bruto.ias : [],
    trocas: Array.isArray(bruto.trocas) ? bruto.trocas : [],
  }
}

function lerRegistro(caminho: string): RegistroDeRun | null {
  try {
    return normalizar(caminho, JSON.parse(readFileSync(caminho, 'utf8')) as RunEmDisco)
  } catch {
    return null
  }
}

const registroDoArquivo = memoArquivo((caminho: string): string => caminho, lerRegistro)

function foraDaJanelaPeloNome(nome: string, caminho: string, desdeMs: number): boolean {
  if (RE_ARQUIVO_DE_CONVERSA.test(nome)) {
    try {
      return statSync(caminho).mtimeMs < desdeMs
    } catch {
      return false
    }
  }
  const doNome = instanteDoNome(nome)
  return Number.isFinite(doNome) && doNome < desdeMs
}

function lerLoteDesde(pedidoMs: number): LoteDeRuns {
  const desdeMs = pedidoMs - FOLGA_DO_NOME_MS
  const dir = runsDir()
  if (!existsSync(dir)) return { registros: [], ignorados: 0, desdeMs }
  const registros: RegistroDeRun[] = []
  let ignorados = 0
  for (const nome of readdirSync(dir)) {
    if (!ehArquivoDeSessao(nome)) continue
    const caminho = join(dir, nome)
    if (foraDaJanelaPeloNome(nome, caminho, desdeMs)) continue
    const registro = registroDoArquivo(caminho)
    if (registro) registros.push(registro)
    else ignorados++
  }
  return { registros, ignorados, desdeMs }
}

function lerLoteDaJanelaAtual(): LoteDeRuns {
  return lerLoteDesde(Date.now() - JANELA_COTA_MS)
}

const lotePorDiretorio = memoChave(runsDir, (): (() => LoteDeRuns) => memoTempo(lerLoteDaJanelaAtual, ttlListagemMs()))

export function loteDesde(pedidoMs: number): LoteDeRuns {
  const guardado = lotePorDiretorio()()
  return pedidoMs >= guardado.desdeMs ? guardado : lerLoteDesde(pedidoMs)
}

export interface ContribuicaoDeProvedor {
  provedor: string
  provedorIdentificado: boolean
  modelos: string[]
  custoUsd: number
  tokens: number
  tokensEntrada: number
  tokensSaida: number
  tokensCache: number
  chamadas: number
  porChamada: boolean
  falhou: boolean
}

function doTopoDaRun(r: RegistroDeRun): ContribuicaoDeProvedor {
  return {
    provedor: r.provedor,
    provedorIdentificado: r.provedorIdentificado,
    modelos: r.modelo ? [r.modelo] : [],
    custoUsd: r.custoUsd,
    tokens: r.tokens,
    tokensEntrada: r.tokensEntrada,
    tokensSaida: r.tokensSaida,
    tokensCache: r.tokensCache,
    chamadas: 1,
    porChamada: false,
    falhou: !r.ok,
  }
}

export function contribuicoesDoRegistro(r: RegistroDeRun): ContribuicaoDeProvedor[] {
  if (!r.ias.length) return [doTopoDaRun(r)]
  const porProvedor = new Map<string, ContribuicaoDeProvedor>()
  for (const ia of r.ias) {
    const provedor = ia.provedor || PROVEDOR_DESCONHECIDO
    const atual = porProvedor.get(provedor) ?? {
      provedor,
      provedorIdentificado: !!ia.provedor,
      modelos: [],
      custoUsd: 0,
      tokens: 0,
      tokensEntrada: 0,
      tokensSaida: 0,
      tokensCache: 0,
      chamadas: 0,
      porChamada: true,
      falhou: false,
    }
    atual.custoUsd += Number(ia.custoUsd) || 0
    atual.tokens += Number(ia.tokens) || 0
    atual.tokensEntrada += Number(ia.tokensEntrada) || 0
    atual.tokensSaida += Number(ia.tokensSaida) || 0
    atual.tokensCache += Number(ia.tokensCache) || 0
    atual.chamadas += Number(ia.chamadas) || 0
    atual.falhou = atual.falhou || (Number(ia.falhas) || 0) > 0 || (!r.ok && provedor === r.provedor)
    if (ia.modelo && !atual.modelos.includes(ia.modelo)) atual.modelos.push(ia.modelo)
    porProvedor.set(provedor, atual)
  }
  return [...porProvedor.values()]
}
