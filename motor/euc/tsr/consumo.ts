import { isoAt } from '../../cdl'
import { contribuicoesDoRegistro, loteDesde } from './cota-runs'
import type { ContribuicaoDeProvedor, RegistroDeRun } from './cota-runs'

export const JANELA_5H = 5 * 60 * 60 * 1000
export const JANELA_SEMANA = 7 * 24 * 60 * 60 * 1000

export interface ConsumoDoProvedor {
  provedor: string
  modelos: string[]
  runs: number
  falhas: number
  custoUsd: number
  tokensEntrada: number
  tokensSaida: number
  tokensCache: number
  tokensNaoSeparados: number
  tokens: number
  ultimoEm: string
  porChamada: boolean
}

interface Acumulado {
  consumo: ConsumoDoProvedor
  ultimoMs: number
}

function arredondar4(valor: number): number {
  return Number(valor.toFixed(4))
}

function naoNegativo(valor: number): number {
  return Number.isFinite(valor) && valor > 0 ? valor : 0
}

function custoDe(registro: RegistroDeRun): number {
  return contribuicoesDoRegistro(registro).reduce((a, c) => a + naoNegativo(c.custoUsd), 0)
}

function inicioDaJanela(janelaMs: number, agoraMs: number): number {
  return agoraMs - naoNegativo(janelaMs)
}

function runsDaJanela(janelaMs: number, agoraMs: number): RegistroDeRun[] {
  const inicioMs = inicioDaJanela(janelaMs, agoraMs)
  return loteDesde(inicioMs).registros.filter(r => r.concluidoEmMs >= inicioMs)
}

function runsNoIntervalo(inicioMs: number, fimMs: number): RegistroDeRun[] {
  return loteDesde(inicioMs).registros.filter(r => r.concluidoEmMs >= inicioMs && r.concluidoEmMs <= fimMs)
}

function novoAcumulado(provedor: string): Acumulado {
  return {
    consumo: {
      provedor,
      modelos: [],
      runs: 0,
      falhas: 0,
      custoUsd: 0,
      tokensEntrada: 0,
      tokensSaida: 0,
      tokensCache: 0,
      tokensNaoSeparados: 0,
      tokens: 0,
      ultimoEm: '',
      porChamada: true,
    },
    ultimoMs: Number.NEGATIVE_INFINITY,
  }
}

function somarTokens(c: ConsumoDoProvedor, contribuicao: ContribuicaoDeProvedor): void {
  const entrada = naoNegativo(contribuicao.tokensEntrada)
  const saida = naoNegativo(contribuicao.tokensSaida)
  const cache = naoNegativo(contribuicao.tokensCache)
  const partes = entrada + saida + cache
  const total = naoNegativo(contribuicao.tokens)
  c.tokensEntrada += entrada
  c.tokensSaida += saida
  c.tokensCache += cache
  c.tokensNaoSeparados += Math.max(0, total - partes)
  c.tokens += Math.max(total, partes)
}

function somarRun(acc: Acumulado, registro: RegistroDeRun, contribuicao: ContribuicaoDeProvedor): void {
  const c = acc.consumo
  c.runs += 1
  if (contribuicao.falhou) c.falhas += 1
  c.custoUsd += naoNegativo(contribuicao.custoUsd)
  c.porChamada = c.porChamada && contribuicao.porChamada
  somarTokens(c, contribuicao)
  for (const m of contribuicao.modelos) if (!c.modelos.includes(m)) c.modelos.push(m)
  if (registro.concluidoEmMs > acc.ultimoMs) acc.ultimoMs = registro.concluidoEmMs
}

function fechar(acc: Acumulado): ConsumoDoProvedor {
  return {
    ...acc.consumo,
    custoUsd: arredondar4(acc.consumo.custoUsd),
    modelos: [...acc.consumo.modelos].sort(),
    ultimoEm: Number.isFinite(acc.ultimoMs) ? isoAt(acc.ultimoMs) : '',
  }
}

function porGastoDecrescente(a: ConsumoDoProvedor, b: ConsumoDoProvedor): number {
  return b.custoUsd - a.custoUsd || b.tokens - a.tokens || a.provedor.localeCompare(b.provedor)
}

export function consumoPorProvedor(janelaMs: number, agoraMs: number = Date.now()): ConsumoDoProvedor[] {
  const porProvedor = new Map<string, Acumulado>()
  for (const registro of runsDaJanela(janelaMs, agoraMs)) {
    for (const contribuicao of contribuicoesDoRegistro(registro)) {
      const atual = porProvedor.get(contribuicao.provedor) ?? novoAcumulado(contribuicao.provedor)
      somarRun(atual, registro, contribuicao)
      porProvedor.set(contribuicao.provedor, atual)
    }
  }
  return [...porProvedor.values()].map(fechar).sort(porGastoDecrescente)
}

function indiceDoBalde(quandoMs: number, inicioMs: number, larguraMs: number, baldes: number): number {
  if (!(larguraMs > 0)) return baldes - 1
  const cru = Math.floor((quandoMs - inicioMs) / larguraMs)
  return Math.min(baldes - 1, Math.max(0, cru))
}

export function serieDeCusto(janelaMs: number, baldes: number, agoraMs: number = Date.now()): number[] {
  const quantos = Math.floor(baldes)
  if (!Number.isFinite(quantos) || quantos < 1) return []
  const inicioMs = inicioDaJanela(janelaMs, agoraMs)
  const larguraMs = naoNegativo(janelaMs) / quantos
  const serie = new Array<number>(quantos).fill(0)
  for (const registro of runsDaJanela(janelaMs, agoraMs)) {
    const i = indiceDoBalde(registro.concluidoEmMs, inicioMs, larguraMs, quantos)
    serie[i] = (serie[i] ?? 0) + custoDe(registro)
  }
  return serie.map(arredondar4)
}

export interface GastoDoMotor {
  custoUsd: number
  tokens: number
  runs: number
}

export function gastoDoMotorNoIntervalo(provedor: string, inicioMs: number, fimMs: number): GastoDoMotor {
  const total: GastoDoMotor = { custoUsd: 0, tokens: 0, runs: 0 }
  for (const registro of runsNoIntervalo(inicioMs, fimMs)) {
    for (const c of contribuicoesDoRegistro(registro)) {
      if (c.provedor !== provedor) continue
      total.custoUsd += naoNegativo(c.custoUsd)
      total.tokens += naoNegativo(c.tokens)
      total.runs += 1
    }
  }
  return { ...total, custoUsd: arredondar4(total.custoUsd) }
}
