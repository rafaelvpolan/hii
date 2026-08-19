import { isoAt } from '../card'
import { JANELA_COTA_MS, PROVEDOR_DESCONHECIDO, contribuicoesDoRegistro, loteDesde } from './cota-runs'
import type { ContribuicaoDeProvedor, RegistroDeRun } from './cota-runs'

export { JANELA_COTA_MS, PROVEDOR_DESCONHECIDO }
export type { RegistroDeRun }

export interface UsoDoProvedor {
  provedor: string
  provedorIdentificado: boolean
  runs: number
  runsComFalha: number
  custoUsd: number
  tokens: number
  modelos: string[]
  primeiroEm: string
  ultimoEm: string
  janelaViraEm: string
  janelaViraDaquiMs: number
  limiteAtingido: boolean
  limiteAtingidoEm: string
  limiteMotivo: string
  cardsNoLimite: string[]
  porChamada: boolean
}

export interface LeituraDeCota {
  agora: string
  janelaMs: number
  inicioDaJanela: string
  provedores: UsoDoProvedor[]
  custoUsd: number
  tokens: number
  runs: number
  runsIgnorados: number
  janelaViraEm: string
  janelaViraDaquiMs: number
  limiteAtingido: boolean
}

interface Acumulador {
  uso: UsoDoProvedor
  primeiroMs: number
  ultimoMs: number
  limiteMs: number
}

function novoAcumulador(c: ContribuicaoDeProvedor): Acumulador {
  return {
    uso: {
      provedor: c.provedor,
      provedorIdentificado: c.provedorIdentificado,
      runs: 0,
      runsComFalha: 0,
      custoUsd: 0,
      tokens: 0,
      modelos: [],
      primeiroEm: '',
      ultimoEm: '',
      janelaViraEm: '',
      janelaViraDaquiMs: 0,
      limiteAtingido: false,
      limiteAtingidoEm: '',
      limiteMotivo: '',
      cardsNoLimite: [],
      porChamada: true,
    },
    primeiroMs: Number.POSITIVE_INFINITY,
    ultimoMs: Number.NEGATIVE_INFINITY,
    limiteMs: Number.NEGATIVE_INFINITY,
  }
}

function anotarLimite(acc: Acumulador, registro: RegistroDeRun): void {
  // o limite de cota e do provedor que bateu nele: nao contamina os outros
  // participantes da mesma execucao
  if (registro.classeDeFalha !== 'quota' || registro.provedor !== acc.uso.provedor) return
  acc.uso.limiteAtingido = true
  if (registro.card && !acc.uso.cardsNoLimite.includes(registro.card)) acc.uso.cardsNoLimite.push(registro.card)
  if (registro.concluidoEmMs < acc.limiteMs) return
  acc.limiteMs = registro.concluidoEmMs
  acc.uso.limiteAtingidoEm = registro.concluidoEm
  acc.uso.limiteMotivo = registro.motivoDaFalha
}

function acumular(acc: Acumulador, registro: RegistroDeRun, c: ContribuicaoDeProvedor): void {
  acc.uso.runs += 1
  if (c.falhou) acc.uso.runsComFalha += 1
  acc.uso.custoUsd += c.custoUsd
  acc.uso.tokens += c.tokens
  acc.uso.porChamada = acc.uso.porChamada && c.porChamada
  for (const m of c.modelos) if (!acc.uso.modelos.includes(m)) acc.uso.modelos.push(m)
  acc.primeiroMs = Math.min(acc.primeiroMs, registro.concluidoEmMs)
  acc.ultimoMs = Math.max(acc.ultimoMs, registro.concluidoEmMs)
  anotarLimite(acc, registro)
}

function fechar(acc: Acumulador, agoraMs: number): UsoDoProvedor {
  const viraMs = acc.primeiroMs + JANELA_COTA_MS
  return {
    ...acc.uso,
    custoUsd: Number(acc.uso.custoUsd.toFixed(4)),
    modelos: [...acc.uso.modelos].sort(),
    primeiroEm: isoAt(acc.primeiroMs),
    ultimoEm: isoAt(acc.ultimoMs),
    janelaViraEm: isoAt(viraMs),
    janelaViraDaquiMs: Math.max(0, viraMs - agoraMs),
  }
}

function porGasto(a: UsoDoProvedor, b: UsoDoProvedor): number {
  return b.custoUsd - a.custoUsd || b.tokens - a.tokens || a.provedor.localeCompare(b.provedor)
}

function agrupar(registros: RegistroDeRun[]): Map<string, Acumulador> {
  const porProvedor = new Map<string, Acumulador>()
  for (const registro of registros) {
    for (const c of contribuicoesDoRegistro(registro)) {
      const atual = porProvedor.get(c.provedor) ?? novoAcumulador(c)
      acumular(atual, registro, c)
      porProvedor.set(c.provedor, atual)
    }
  }
  return porProvedor
}

function somar(provedores: UsoDoProvedor[], campo: (u: UsoDoProvedor) => number): number {
  return provedores.reduce((total, u) => total + campo(u), 0)
}

export function lerCota(agoraMs: number = Date.now()): LeituraDeCota {
  const inicioMs = agoraMs - JANELA_COTA_MS
  const lote = loteDesde(inicioMs)
  const naJanela = lote.registros.filter(r => r.concluidoEmMs >= inicioMs)
  const provedores = [...agrupar(naJanela).values()].map(acc => fechar(acc, agoraMs)).sort(porGasto)
  const proximaVirada = provedores.reduce((menor, u) => Math.min(menor, u.janelaViraDaquiMs), Number.POSITIVE_INFINITY)
  const virandoEm = provedores.find(u => u.janelaViraDaquiMs === proximaVirada)
  return {
    agora: isoAt(agoraMs),
    janelaMs: JANELA_COTA_MS,
    inicioDaJanela: isoAt(inicioMs),
    provedores,
    custoUsd: Number(somar(provedores, u => u.custoUsd).toFixed(4)),
    tokens: somar(provedores, u => u.tokens),
    runs: naJanela.length,
    runsIgnorados: lote.ignorados,
    janelaViraEm: virandoEm?.janelaViraEm ?? '',
    janelaViraDaquiMs: virandoEm?.janelaViraDaquiMs ?? 0,
    limiteAtingido: provedores.some(u => u.limiteAtingido),
  }
}
