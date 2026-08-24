import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../cdl/ali/config.ts'
import { ENV_TOPOLOGIA_FILE } from '../cdl/ali/contrato.ts'
import { STATUSES } from '../cdl/index.ts'
import type { Status } from '../cdl/index.ts'

export interface Topologia {
  readonly versao: number
  readonly nos: readonly Status[]
  readonly transicoes: readonly (readonly [Status, Status])[]
  // Rotas de recuperacao (reinicio de daemon, retomada humana, espera por falha
  // transitoria). Separadas para o caminho normal continuar legivel, mas valem
  // como transicao declarada — sem elas o observador de deriva grita em toda
  // recuperacao e o alarme perde o sentido.
  readonly transicoesDeRecuperacao: readonly (readonly [Status, Status])[]
  readonly sempreAlcancavel: readonly Status[]
  readonly checkpointsHumanos: readonly Status[]
  readonly semEscritaNoMotor: { readonly estados: readonly Status[] }
}

interface TopologiaCrua {
  versao?: number
  nos?: string[]
  transicoes?: string[][]
  transicoesDeRecuperacao?: string[][]
  sempreAlcancavel?: string[]
  checkpointsHumanos?: string[]
  semEscritaNoMotor?: { estados?: string[] }
}

export function arquivoDaTopologia(): string {
  return process.env[ENV_TOPOLOGIA_FILE] || join(ROOT, 'config', 'topologia.json')
}

function ehStatus(v: string): v is Status {
  return (STATUSES as readonly string[]).includes(v)
}

function statusesDe(lista: string[] | undefined, onde: string): Status[] {
  const fora = (lista ?? []).filter(v => !ehStatus(v))
  if (fora.length) throw new Error(`topologia.json: ${onde} cita estado inexistente: ${fora.join(', ')}`)
  return (lista ?? []) as Status[]
}

function paresDe(lista: string[][] | undefined, onde: string): (readonly [Status, Status])[] {
  return (lista ?? []).map((par, i) => {
    if (par.length !== 2) throw new Error(`topologia.json: ${onde} ${i} nao e um par`)
    const validos = statusesDe(par, `${onde}[${i}]`)
    const de = validos[0]
    const para = validos[1]
    if (!de || !para) throw new Error(`topologia.json: ${onde} ${i} incompleta`)
    return [de, para] as const
  })
}

export function lerTopologia(): Topologia {
  const cru = JSON.parse(readFileSync(arquivoDaTopologia(), 'utf8')) as TopologiaCrua
  const transicoes = paresDe(cru.transicoes, 'transicoes')
  return {
    versao: cru.versao ?? 0,
    nos: statusesDe(cru.nos, 'nos'),
    transicoes,
    transicoesDeRecuperacao: paresDe(cru.transicoesDeRecuperacao, 'transicoesDeRecuperacao'),
    sempreAlcancavel: statusesDe(cru.sempreAlcancavel, 'sempreAlcancavel'),
    checkpointsHumanos: statusesDe(cru.checkpointsHumanos, 'checkpointsHumanos'),
    semEscritaNoMotor: { estados: statusesDe(cru.semEscritaNoMotor?.estados, 'semEscritaNoMotor.estados') },
  }
}

// Puro de proposito: NMY nao executa transicao nenhuma, so responde se ela esta
// declarada. Quem move o card continua sendo o OSW.
export function transicaoPermitida(topo: Topologia, de: Status, para: Status): boolean {
  if (de === para) return true
  if (topo.sempreAlcancavel.includes(para)) return true
  return todasAsTransicoes(topo).some(([a, b]) => a === de && b === para)
}

export function todasAsTransicoes(topo: Topologia): readonly (readonly [Status, Status])[] {
  return [...topo.transicoes, ...topo.transicoesDeRecuperacao]
}

export function destinosDe(topo: Topologia, de: Status): Status[] {
  const declarados = todasAsTransicoes(topo).filter(([a]) => a === de).map(([, b]) => b)
  return Array.from(new Set([...declarados, ...topo.sempreAlcancavel])).filter(s => s !== de)
}
