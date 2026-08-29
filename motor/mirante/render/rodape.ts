import type { Fields } from '../../cordel/index.ts'
import { isActive, esperaHumano } from './phases.ts'
import { idadeDe } from './board.ts'
import { truncVisible } from '../tui/layout.ts'
import { marcaCurtaDoDisco } from './disco.ts'
import type { UsoDeDisco } from '../../euclides/estado-em-disco.ts'

const RESET = '\x1b[0m'
const DIM = '\x1b[2m'
const CYAN = '\x1b[36m'
const YELLOW = '\x1b[33m'
const BOLD = '\x1b[1m'

export const GIRO = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

export interface Propriedades {
  provedor: string
  modelo: string
  effort: string
  modo: string
  projeto: string
  custoHoje: string
  pisoDoGasto: string
  divergentes: string[]
  disco?: UsoDeDisco
  // Aparece junto com as ias selecionadas porque e o que o gauntlet TROCA: ligado,
  // o crivo compara telas e nao le o diff. Estado invisivel seria a mesma falha de
  // antes com outro nome.
  gauntlet?: boolean
}

export interface RodapeOptions {
  color: boolean
  now: number
  width: number
  selecionado: string
  maxLinhas: number
}

const PADRAO: RodapeOptions = { color: false, now: 0, width: 80, selecionado: '', maxLinhas: 3 }

const BARRA = '▌'

function selecionada(id: string, o: RodapeOptions): boolean {
  return !!o.selecionado && o.selecionado === id
}

function marca(id: string, o: RodapeOptions): string {
  return selecionada(id, o) ? paint(BARRA, CYAN, o) : ' '
}

function realce(texto: string, id: string, o: RodapeOptions): string {
  if (!selecionada(id, o) || !o.color) return texto
  return `${BOLD}${texto}${RESET}`
}

function aberta(id: string, o: RodapeOptions): string {
  return selecionada(id, o) ? paint('  ← aberta', CYAN, o) : ''
}

function paint(s: string, code: string, o: RodapeOptions): string {
  return o.color ? `${code}${s}${RESET}` : s
}

export function quadroDoGiro(now: number): string {
  return GIRO[Math.floor(now / 120) % GIRO.length] ?? GIRO[0] ?? '⠋'
}

function gastoDoDia(p: Propriedades, o: RodapeOptions): string {
  if (!p.custoHoje) return ''
  return `gasto ${paint(`${p.pisoDoGasto ? '≥ ' : ''}US$${p.custoHoje}`, CYAN, o)}`
}

function motivoDoPiso(p: Propriedades, o: RodapeOptions): string {
  if (!p.custoHoje || !p.pisoDoGasto) return ''
  return paint(` · piso: ${p.pisoDoGasto} sem reporte de gasto`, YELLOW, o)
}

export function linhaPropriedades(p: Propriedades, opts: Partial<RodapeOptions> = {}): string {
  const o = { ...PADRAO, ...opts }
  const ia = p.modelo ? `${p.provedor}/${p.modelo}` : p.provedor
  const partes = [
    `ia ${paint(ia, CYAN, o)}`,
    `esforco ${paint(p.effort, CYAN, o)}`,
    p.modo ? `modo ${paint(p.modo, CYAN, o)}` : '',
    p.gauntlet ? `crivo ${paint('gauntlet', YELLOW, o)}` : '',
    p.projeto ? `projeto ${paint(p.projeto, CYAN, o)}` : '',
    gastoDoDia(p, o),
    p.disco ? marcaCurtaDoDisco(p.disco, { color: o.color }) : '',
  ].filter(Boolean)
  const base = paint(partes.join(paint(' · ', DIM, o)), DIM, o) + motivoDoPiso(p, o)
  if (!p.divergentes.length) return base
  return `${base}${paint(`  (${p.divergentes.join(' · ')})`, YELLOW, o)}`
}

export interface EmExecucao {
  id: string
  titulo: string
  estado: string
  agente: string
  desde: string
}

export function emExecucao(cards: Fields[], repo: string, now: number, agenteDe: (id: string) => string): EmExecucao[] {
  return cards
    .filter(c => (!repo || c.repo === repo) && isActive(String(c.status ?? '')))
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map(c => ({
      id: String(c.id ?? ''),
      titulo: String(c.title ?? ''),
      estado: String(c.status ?? ''),
      agente: agenteDe(String(c.id ?? '')),
      desde: idadeDe(c.updated, now),
    }))
}

export interface Espera {
  id: string
  titulo: string
  motivo: string
  comando: string
  projeto: string
}

export function esperandoEmOutrosProjetos(cards: Fields[], repo: string): Espera[] {
  if (!repo) return []
  return esperandoVoce(cards, '').filter(e => e.projeto !== repo)
}

export function linhaDeOutrosProjetos(fora: Espera[], opts: Partial<RodapeOptions> = {}): string[] {
  const o = { ...PADRAO, ...opts }
  if (!fora.length) return []
  const projetos = [...new Set(fora.map(e => e.projeto.split('/').filter(Boolean).pop() ?? e.projeto))]
  const quantos = fora.length === 1 ? '1 tarefa' : `${fora.length} tarefas`
  const onde = projetos.slice(0, 2).join(', ') + (projetos.length > 2 ? ` +${projetos.length - 2}` : '')
  const primeiro = fora[0]
  const como = primeiro ? ` → ${primeiro.comando}` : ''
  return [truncVisible(paint(`  ${quantos} esperando em ${onde}${como}`, YELLOW, o), o.width)]
}

export function esperandoVoce(cards: Fields[], repo: string): Espera[] {
  return cards
    .filter(c => !repo || c.repo === repo)
    .map(c => ({ card: c, esp: esperaHumano(String(c.status ?? '')) }))
    .filter((x): x is { card: Fields; esp: { motivo: string; comando: string } } => !!x.esp)
    .sort((a, b) => Number(a.card.id) - Number(b.card.id))
    .map(({ card, esp }) => ({
      id: String(card.id ?? ''),
      titulo: String(card.title ?? ''),
      motivo: esp.motivo,
      comando: esp.comando ? `${esp.comando} ${Number(card.id)}` : String(Number(card.id)),
      projeto: String(card.repo ?? ''),
    }))
}

export function linhasEspera(lista: Espera[], opts: Partial<RodapeOptions> = {}): string[] {
  const o = { ...PADRAO, ...opts }
  if (!lista.length) return []
  const mostrar = janelaDaLista(lista, o.selecionado, o.maxLinhas)
  const linhas = mostrar.map(e => {
    const titulo = e.titulo.slice(0, Math.max(10, o.width - 52))
    const id = paint(`#${e.id.padStart(3, '0')}`, DIM, o)
    const cauda = paint(`${e.motivo} → ${e.comando}`, DIM, o)
    return `${marca(e.id, o)}${paint('●', YELLOW, o)} ${id} ${realce(titulo, e.id, o)} ${cauda}${aberta(e.id, o)}`
  })
  const resto = lista.length - mostrar.length
  if (resto > 0) linhas.push(paint(`  e mais ${resto} esperando voce`, DIM, o))
  return linhas
}

export function janelaDaLista<T extends { id: string }>(lista: T[], selecionado: string, max: number): T[] {
  if (lista.length <= max) return lista
  const i = lista.findIndex(x => x.id === selecionado)
  if (i < 0) return lista.slice(0, max)
  const inicio = Math.max(0, Math.min(i - Math.floor((max - 1) / 2), lista.length - max))
  return lista.slice(inicio, inicio + max)
}

function contador(total: number, mostrados: number, o: RodapeOptions): string[] {
  const resto = total - mostrados
  return resto > 0 ? [paint(`  e mais ${resto}`, DIM, o)] : []
}

export function linhasExecucao(lista: EmExecucao[], opts: Partial<RodapeOptions> = {}): string[] {
  const o = { ...PADRAO, ...opts }
  if (!lista.length) return [paint('nada em execucao', DIM, o)]
  const giro = quadroDoGiro(o.now)
  const visiveis = janelaDaLista(lista, o.selecionado, o.maxLinhas)
  return [...visiveis.map((e) => {
    const meio = [e.estado.toLowerCase(), e.agente, e.desde].filter(Boolean).join(' · ')
    const titulo = e.titulo.slice(0, Math.max(10, o.width - 46))
    const id = paint(`#${e.id.padStart(3, '0')}`, DIM, o)
    return `${marca(e.id, o)}${paint(giro, CYAN, o)} ${id} ${realce(titulo, e.id, o)} ${paint(meio, DIM, o)}${aberta(e.id, o)}`
  }), ...contador(lista.length, visiveis.length, o)]
}

