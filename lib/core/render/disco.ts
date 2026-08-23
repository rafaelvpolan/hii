import { mb } from '../../../motor/euc/estado-em-disco'
import type { NivelDeDisco, UsoDeDisco } from '../../../motor/euc/estado-em-disco'

const RESET = '\x1b[0m'
const DIM = '\x1b[2m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'

export interface OpcoesDeDisco {
  color: boolean
  detalhe: boolean
}

const PADRAO: OpcoesDeDisco = { color: false, detalhe: false }

function corDoNivel(nivel: NivelDeDisco): string {
  if (nivel === 'teto') return RED
  if (nivel === 'alerta') return YELLOW
  return DIM
}

function detalheDoDisco(uso: UsoDeDisco): string {
  return uso.areas.filter(a => a.bytes > 0).map(a => `${a.area} ${mb(a.bytes)}`).join(' · ')
}

function avisoDoNivel(uso: UsoDeDisco): string {
  if (uso.nivel === 'teto') return `NO TETO de ${mb(uso.teto)} — o motor recusa nova referencia`
  if (uso.nivel === 'alerta') return `passou de ${mb(uso.alerta)}, teto em ${mb(uso.teto)}`
  return ''
}

function avisoCurto(uso: UsoDeDisco): string {
  if (uso.nivel === 'teto') return 'NO TETO'
  if (uso.nivel === 'alerta') return 'perto do teto'
  return ''
}

export function marcaCurtaDoDisco(uso: UsoDeDisco, opts: Partial<OpcoesDeDisco> = {}): string {
  const o = { ...PADRAO, ...opts }
  const aviso = avisoCurto(uso)
  const texto = `disco ${mb(uso.bytes)}${aviso ? ` (${aviso})` : ''}`
  return o.color ? `${corDoNivel(uso.nivel)}${texto}${RESET}` : texto
}

export function textoDoDisco(uso: UsoDeDisco, opts: Partial<OpcoesDeDisco> = {}): string {
  const o = { ...PADRAO, ...opts }
  const detalhe = o.detalhe ? detalheDoDisco(uso) : ''
  const aviso = avisoDoNivel(uso)
  return [
    `disco ${mb(uso.bytes)}`,
    detalhe ? `(${detalhe})` : '',
    aviso ? `— ${aviso}` : '',
  ].filter(Boolean).join(' ')
}

export function marcaDoDisco(uso: UsoDeDisco, opts: Partial<OpcoesDeDisco> = {}): string {
  const o = { ...PADRAO, ...opts }
  const texto = textoDoDisco(uso, o)
  return o.color ? `${corDoNivel(uso.nivel)}${texto}${RESET}` : texto
}

export function linhasDoDisco(uso: UsoDeDisco, opts: Partial<OpcoesDeDisco> = {}): string[] {
  const o = { ...PADRAO, ...opts, detalhe: true }
  const linhas = [`  ${marcaDoDisco(uso, o)}`]
  for (const area of uso.areas) {
    linhas.push(`    ${area.area.padEnd(6)} ${mb(area.bytes).padStart(9)}  ${area.arquivos} arquivo(s)  ${area.caminho}`)
  }
  if (uso.nivel !== 'ok') {
    linhas.push('    limpe o transitorio com `hii disco --limpar` ou suba HICODE_DISCO_TETO_MB')
  }
  return linhas
}
