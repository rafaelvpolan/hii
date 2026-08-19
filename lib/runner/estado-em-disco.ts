import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { cardsDir, numeroDeEnv } from './config'

export const MAX_REFS_POR_TAREFA = 8

function refsRaiz(): string {
  return join(cardsDir(), 'refs')
}

export function refsDir(id: string): string {
  return join(refsRaiz(), id)
}

export function refsFile(id: string): string {
  return join(refsRaiz(), `${id}.json`)
}

function tmpRaiz(): string {
  return join(cardsDir(), 'tmp')
}

function dirDeTransito(): string {
  return join(tmpRaiz(), 'transito')
}

export function dirDaSessao(sessao: string): string {
  return join(tmpRaiz(), 'sessao', sessao)
}

export function garantirDir(caminho: string): string {
  if (!existsSync(caminho)) mkdirSync(caminho, { recursive: true })
  return caminho
}

function alertaBytes(): number {
  return numeroDeEnv('HICODE_DISCO_ALERTA_MB', 200) * 1024 * 1024
}

export function tetoBytes(): number {
  return numeroDeEnv('HICODE_DISCO_TETO_MB', 1024) * 1024 * 1024
}

function ttlDoTmpMs(): number {
  return numeroDeEnv('HICODE_TMP_TTL_H', 24) * 3600_000
}

export interface Medida {
  bytes: number
  arquivos: number
}

function medirDir(caminho: string): Medida {
  if (!existsSync(caminho)) return { bytes: 0, arquivos: 0 }
  let bytes = 0
  let arquivos = 0
  for (const entrada of readdirSync(caminho, { withFileTypes: true })) {
    const filho = join(caminho, entrada.name)
    if (entrada.isDirectory()) {
      const dentro = medirDir(filho)
      bytes += dentro.bytes
      arquivos += dentro.arquivos
      continue
    }
    try {
      bytes += statSync(filho).size
      arquivos += 1
    } catch {
      continue
    }
  }
  return { bytes, arquivos }
}

export type NivelDeDisco = 'ok' | 'alerta' | 'teto'

export interface AreaDeDisco extends Medida {
  area: string
  caminho: string
}

export interface UsoDeDisco {
  areas: AreaDeDisco[]
  bytes: number
  arquivos: number
  alerta: number
  teto: number
  nivel: NivelDeDisco
}

const AREAS: { area: string; dir: () => string }[] = [
  { area: 'refs', dir: refsRaiz },
  { area: 'tmp', dir: tmpRaiz },
  { area: 'urls', dir: () => join(cardsDir(), 'urls') },
  { area: 'runs', dir: () => join(cardsDir(), 'runs') },
]

export function nivelDe(bytes: number, alerta = alertaBytes(), teto = tetoBytes()): NivelDeDisco {
  if (teto > 0 && bytes >= teto) return 'teto'
  if (alerta > 0 && bytes >= alerta) return 'alerta'
  return 'ok'
}

export function usoDeDisco(): UsoDeDisco {
  const areas = AREAS.map(({ area, dir }): AreaDeDisco => {
    const caminho = dir()
    return { area, caminho, ...medirDir(caminho) }
  })
  const bytes = areas.reduce((a, x) => a + x.bytes, 0)
  const arquivos = areas.reduce((a, x) => a + x.arquivos, 0)
  const alerta = alertaBytes()
  const teto = tetoBytes()
  return { areas, bytes, arquivos, alerta, teto, nivel: nivelDe(bytes, alerta, teto) }
}

export interface Recusa {
  ok: false
  motivo: string
}

export interface Aceite {
  ok: true
  motivo: ''
}

export type VerdictoDeDisco = Aceite | Recusa

export function mb(bytes: number): string {
  if (bytes <= 0) return '0 MB'
  const megas = bytes / (1024 * 1024)
  if (megas < 0.1) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (megas < 10) return `${megas.toFixed(1)} MB`
  if (megas < 1024) return `${Math.round(megas)} MB`
  return `${(megas / 1024).toFixed(1)} GB`
}

export function cabeNoDisco(bytesNovos = 0, uso: UsoDeDisco = usoDeDisco()): VerdictoDeDisco {
  if (uso.teto <= 0) return { ok: true, motivo: '' }
  const total = uso.bytes + Math.max(0, bytesNovos)
  if (total < uso.teto) return { ok: true, motivo: '' }
  return {
    ok: false,
    motivo: `estado do motor em ${mb(uso.bytes)}, no teto de ${mb(uso.teto)} — limpe com \`hii disco --limpar\` ou suba HICODE_DISCO_TETO_MB`,
  }
}

export interface LimpezaDeTmp {
  removidos: string[]
  bytesLiberados: number
}

function tamanhoDe(caminho: string): number {
  try {
    return statSync(caminho).size
  } catch {
    return 0
  }
}

function idadeDe(caminho: string, agoraMs: number): number {
  try {
    return agoraMs - statSync(caminho).mtimeMs
  } catch {
    return 0
  }
}

export function limparTmpAntigo(idadeMinimaMs = ttlDoTmpMs(), agoraMs = Date.now(), preservar: string[] = []): LimpezaDeTmp {
  const removidos: string[] = []
  let bytesLiberados = 0
  const raizes = [dirDeTransito(), join(tmpRaiz(), 'sessao')]
  for (const raiz of raizes) {
    if (!existsSync(raiz)) continue
    for (const entrada of readdirSync(raiz, { withFileTypes: true })) {
      const filho = join(raiz, entrada.name)
      if (preservar.includes(filho)) continue
      if (idadeDe(filho, agoraMs) < idadeMinimaMs) continue
      const bytes = entrada.isDirectory() ? medirDir(filho).bytes : tamanhoDe(filho)
      try {
        rmSync(filho, { recursive: true, force: true })
        removidos.push(filho)
        bytesLiberados += bytes
      } catch {
        continue
      }
    }
  }
  return { removidos, bytesLiberados }
}

let cacheChave = ''
let cacheQuando = -Infinity
let cacheValor: UsoDeDisco | null = null

const TTL_DO_USO_MS = 5000

export function usoDeDiscoCacheado(ttlMs = TTL_DO_USO_MS, agoraMs = Date.now()): UsoDeDisco {
  const chave = cardsDir()
  if (!cacheValor || chave !== cacheChave || agoraMs - cacheQuando >= ttlMs) {
    cacheValor = usoDeDisco()
    cacheChave = chave
    cacheQuando = agoraMs
  }
  return cacheValor
}

