import { profundidadeDeCor, sequenciaDe } from '../tui/paleta.ts'
import type { OpcoesTinta, Rgb } from '../tui/paleta.ts'

const RESET = '\x1b[0m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'

export const CORES_DE_PROJETO = [
  '\x1b[36m',
  '\x1b[35m',
  '\x1b[32m',
  '\x1b[33m',
  '\x1b[34m',
  '\x1b[31m',
]

export const TONS_SUAVES_DE_PROJETO: Rgb[] = [
  { r: 96, g: 150, b: 160 },
  { r: 150, g: 120, b: 160 },
  { r: 110, g: 150, b: 120 },
  { r: 160, g: 145, b: 100 },
  { r: 110, g: 130, b: 170 },
  { r: 165, g: 110, b: 110 },
]

export function indiceDaCorDoProjeto(repo: string, indice = -1): number {
  if (indice >= 0) return indice % CORES_DE_PROJETO.length
  let soma = 0
  for (const c of repo) soma = (soma + c.charCodeAt(0)) % 997
  return soma % CORES_DE_PROJETO.length
}

export function corDoProjeto(repo: string, indice = -1): string {
  return CORES_DE_PROJETO[indiceDaCorDoProjeto(repo, indice)] ?? CORES_DE_PROJETO[0] ?? ''
}

export function tintaDoProjeto(repo: string, indice: number, o: OpcoesTinta): string {
  if (!o.color) return ''
  const p = o.profundidade ?? profundidadeDeCor()
  if (p === 'nenhuma') return ''
  if (p === 'basico') return corDoProjeto(repo, indice)
  const tom = TONS_SUAVES_DE_PROJETO[indiceDaCorDoProjeto(repo, indice)] ?? TONS_SUAVES_DE_PROJETO[0]
  return tom ? sequenciaDe(tom, p) : ''
}

export function nomeCurto(repo: string): string {
  return repo.split('/').pop() || repo
}

export interface EtiquetaOptions {
  color: boolean
  indice: number
  detalhe: string
  branch: string
}

export function etiquetaDoProjeto(repo: string, opts: Partial<EtiquetaOptions> = {}): string {
  const o = { color: false, indice: -1, detalhe: '', branch: '', ...opts }
  if (!repo) return o.color ? `${DIM}sem projeto — /repo escolhe${RESET}` : 'sem projeto — /repo escolhe'
  const cor = tintaDoProjeto(repo, o.indice, { color: o.color })
  const nome = nomeCurto(repo)
  const marca = o.color ? `${cor}●${RESET} ${cor}${BOLD}${nome}${RESET}` : `● ${nome}`
  const dono = repo.includes('/') ? (o.color ? `${DIM} ${repo.split('/')[0]}${RESET}` : ` ${repo.split('/')[0]}`) : ''
  const ramo = o.branch ? (o.color ? `${DIM}  ⎇ ${RESET}${o.branch}` : `  ⎇ ${o.branch}`) : ''
  const extra = o.detalhe ? (o.color ? `${DIM}  ${o.detalhe}${RESET}` : `  ${o.detalhe}`) : ''
  return `${marca}${dono}${ramo}${extra}`
}
