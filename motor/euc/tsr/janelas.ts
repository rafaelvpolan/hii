import { harnessPorNome } from '../../tmd/registro.ts'
import type { JanelaDeUso } from './planos.ts'
import type { HarnessId } from '../../tmd/tipos.ts'

const HORA_MS = 3600_000
const DIA_MS = 24 * HORA_MS

const PADRAO_POR_PROVEDOR: Record<string, string[]> = {
  claude: ['5h', '7d'],
  codex: ['5h', '7d'],
  kimi: ['5h', '7d'],
  ollama: [],
}

export function duracaoDaJanela(rotulo: string): number {
  const m = /^(\d+)\s*([hdm])$/i.exec(rotulo.trim())
  if (!m) return 0
  const n = Number(m[1])
  const unidade = (m[2] ?? '').toLowerCase()
  if (unidade === 'm') return n * 60_000
  if (unidade === 'd') return n * DIA_MS
  return n * HORA_MS
}

function daEnv(nome: string): string[] {
  const bruto = process.env[`HICODE_JANELAS_${nome.toUpperCase()}`] ?? ''
  return bruto.split(',').map(s => s.trim()).filter(s => duracaoDaJanela(s) > 0)
}

export function rotulosDoProvedor(nome: string): string[] {
  const escolhidos = daEnv(nome)
  if (escolhidos.length) return escolhidos
  return PADRAO_POR_PROVEDOR[nome] ?? ['5h', '7d']
}

export interface JanelaDeProvedor {
  rotulo: string
  ms: number
  inicioMs: number
  fimMs: number
  percentualDoLimite: number | null
  limiteConfiavel: boolean
  resetaEm: string
  restamMs: number
}

function reportadaComoRotulo(janelas: JanelaDeUso[], rotulo: string): JanelaDeUso | null {
  return janelas.find(j => j.rotulo === rotulo) ?? null
}

function fimDaJanela(reportada: JanelaDeUso | null, agoraMs: number): number {
  const reset = reportada ? Date.parse(reportada.resetaEm) : Number.NaN
  return Number.isFinite(reset) && reset > agoraMs ? reset : agoraMs
}

function idadeDaMedicaoMs(idadeHoras: number): number {
  return idadeHoras >= 0 ? idadeHoras * HORA_MS : Number.POSITIVE_INFINITY
}

export function janelasDoProvedor(nome: HarnessId, agoraMs: number = Date.now()): JanelaDeProvedor[] {
  const plano = harnessPorNome(nome).plano(agoraMs)
  const idadeMs = idadeDaMedicaoMs(plano.idadeHoras)
  return rotulosDoProvedor(nome).map((rotulo): JanelaDeProvedor => {
    const ms = duracaoDaJanela(rotulo)
    const reportada = reportadaComoRotulo(plano.janelas, rotulo)
    const fimMs = fimDaJanela(reportada, agoraMs)
    return {
      rotulo,
      ms,
      inicioMs: fimMs - ms,
      fimMs,
      percentualDoLimite: reportada ? reportada.percentual : null,
      limiteConfiavel: !!reportada && idadeMs < ms,
      resetaEm: reportada?.resetaEm ?? '',
      restamMs: Math.max(0, fimMs - agoraMs),
    }
  })
}
