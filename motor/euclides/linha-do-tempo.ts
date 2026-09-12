import type { EventoDoCard } from './eventos.ts'
import type { ChamadaDeIa, PapelDeChamada } from '../cordel/tipos.ts'

export interface AtividadeDaIa {
  readonly tipo: string
  readonly nome: string
  readonly alvo: string
  readonly ts: string
  readonly args?: string
  readonly resultado?: string
  readonly raia?: string
}

export interface ChamadaNaLinha {
  readonly tipo: 'chamada'
  readonly ts: string
  readonly rotulo: string
  readonly raia: string
  readonly papel: PapelDeChamada
  readonly modelo: string
  readonly atividades: readonly AtividadeDaIa[]
  readonly concluida: boolean
  readonly custoAnunciado: string
  readonly ledger?: ChamadaDeIa
}

export type Marco =
  | { readonly tipo: 'fase'; readonly ts: string; readonly fase: string; readonly inicio: boolean; readonly detalhe: string }
  | { readonly tipo: 'gate'; readonly ts: string; readonly fase: string; readonly inicio: boolean; readonly veredito: string; readonly motivo: string }
  | { readonly tipo: 'reparo'; readonly ts: string; readonly fase: string; readonly detalhe: string }
  | { readonly tipo: 'tier'; readonly ts: string; readonly detalhe: string }
  | { readonly tipo: 'checkpoint'; readonly ts: string; readonly estado: string; readonly aberto: boolean; readonly detalhe: string }
  | { readonly tipo: 'troca'; readonly ts: string; readonly papel: PapelDeChamada; readonly de: string; readonly para: string }
  | { readonly tipo: 'evento'; readonly ts: string; readonly evento: string; readonly detalhe: string }
  | ChamadaNaLinha

export interface FontesDaLinha {
  readonly eventos: readonly EventoDoCard[]
  readonly chamadas: readonly ChamadaDeIa[]
  readonly atividades: readonly AtividadeDaIa[]
}

const PAPEIS: readonly PapelDeChamada[] = ['implement', 'verify', 'gate', 'step', 'clarify', 'conversa', 'classificacao', 'ideacao', 'avaliacao', 'desconhecido']

export function papelDoRotulo(rotulo: string): PapelDeChamada {
  const primeiro = rotulo.split('·')[0]?.trim() ?? ''
  return (PAPEIS as readonly string[]).includes(primeiro) ? (primeiro as PapelDeChamada) : 'desconhecido'
}

interface BlocoAberto {
  ts: string
  rotulo: string
  raia: string
  modelo: string
  atividades: AtividadeDaIa[]
  concluida: boolean
  custoAnunciado: string
}

function ehCabecalho(a: AtividadeDaIa): boolean {
  return a.tipo === 'sessao'
}

export function blocosDeChamada(atividades: readonly AtividadeDaIa[]): ChamadaNaLinha[] {
  const blocos: BlocoAberto[] = []
  const abertoPorRaia = new Map<string, BlocoAberto>()
  let ultimoTs = ''
  const abrir = (a: AtividadeDaIa, raia: string): BlocoAberto => {
    if (a.ts) ultimoTs = a.ts
    const b: BlocoAberto = { ts: a.ts || ultimoTs, rotulo: (a.args ?? '').trim(), raia, modelo: a.alvo, atividades: [], concluida: false, custoAnunciado: '' }
    blocos.push(b)
    abertoPorRaia.set(raia, b)
    return b
  }
  for (const a of atividades) {
    const raia = a.raia ?? ''
    if (ehCabecalho(a)) {
      const aberto = abertoPorRaia.get(raia)
      if (aberto && !aberto.concluida && a.nome === 'sessao' && !aberto.modelo) { aberto.modelo = a.alvo; continue }
      abrir(a, raia)
      continue
    }
    const b = abertoPorRaia.get(raia) ?? abrir({ ...a, args: '', alvo: '' }, raia)
    if (a.tipo === 'fim') {
      b.concluida = true
      b.custoAnunciado = a.nome === 'timeout' ? 'TIMEOUT' : a.alvo
      abertoPorRaia.delete(raia)
      continue
    }
    b.atividades.push(a)
  }
  return blocos.map(b => ({ tipo: 'chamada', ts: b.ts, rotulo: b.rotulo, raia: b.raia, papel: papelDoRotulo(b.rotulo), modelo: b.modelo, atividades: b.atividades, concluida: b.concluida, custoAnunciado: b.custoAnunciado }))
}

function tirar(livres: ChamadaDeIa[], indice: number): ChamadaDeIa | undefined {
  return indice >= 0 ? livres.splice(indice, 1)[0] : undefined
}

// Duas passagens. A primeira casa por ROTULO, que o ledger grava desde que o
// rotulo passou a comecar pelo papel: e a unica chave que nao se confunde quando
// duas raias do mesmo papel rodam juntas e a que abriu depois termina antes. A
// segunda, so para ledger antigo sem rotulo, cai na heuristica por papel e ordem.
export function casarComLedger(blocos: readonly ChamadaNaLinha[], chamadas: readonly ChamadaDeIa[]): ChamadaNaLinha[] {
  const livres = [...chamadas].sort((a, b) => a.ts.localeCompare(b.ts))
  const casados = new Map<ChamadaNaLinha, ChamadaDeIa>()
  for (const b of blocos) {
    if (!b.concluida || !b.rotulo) continue
    const exato = livres.findIndex(c => c.rotulo === b.rotulo && c.ts >= b.ts)
    const ledger = tirar(livres, exato >= 0 ? exato : livres.findIndex(c => c.rotulo === b.rotulo))
    if (ledger) casados.set(b, ledger)
  }
  for (const b of blocos) {
    if (casados.has(b) || !b.concluida || b.papel === 'desconhecido') continue
    const i = livres.findIndex(c => !c.rotulo && c.papel === b.papel && c.ts >= b.ts)
    const ledger = tirar(livres, i >= 0 ? i : livres.findIndex(c => !c.rotulo && c.papel === b.papel))
    if (ledger) casados.set(b, ledger)
  }
  return blocos.map(b => {
    const ledger = casados.get(b)
    return ledger ? { ...b, ledger, modelo: b.modelo || ledger.modelo } : b
  })
}

export function trocasNaLinha(chamadas: readonly ChamadaDeIa[]): Marco[] {
  const ultimo = new Map<PapelDeChamada, string>()
  const saida: Marco[] = []
  for (const c of [...chamadas].sort((a, b) => a.ts.localeCompare(b.ts))) {
    const anterior = ultimo.get(c.papel)
    if (anterior && anterior !== c.provedor) saida.push({ tipo: 'troca', ts: c.ts, papel: c.papel, de: anterior, para: c.provedor })
    ultimo.set(c.papel, c.provedor)
  }
  return saida
}

function primeiraPalavra(s: string): string {
  return s.trim().split(/[\s:—-]+/)[0] ?? ''
}

export function marcoDoEvento(e: EventoDoCard): Marco {
  const fase = e.fase ?? ''
  const detalhe = e.detalhe ?? ''
  switch (e.evento) {
    case 'fase_inicio': return { tipo: 'fase', ts: e.ts, fase, inicio: true, detalhe }
    case 'fase_fim': return { tipo: 'fase', ts: e.ts, fase, inicio: false, detalhe }
    case 'gate_start': return { tipo: 'gate', ts: e.ts, fase, inicio: true, veredito: '', motivo: detalhe }
    case 'gate_verdict': return { tipo: 'gate', ts: e.ts, fase, inicio: false, veredito: primeiraPalavra(detalhe), motivo: e.resultado ?? detalhe.slice(primeiraPalavra(detalhe).length).replace(/^[\s:—-]+/, '') }
    case 'repair_attempt': return { tipo: 'reparo', ts: e.ts, fase, detalhe }
    case 'model_tier_selected': return { tipo: 'tier', ts: e.ts, detalhe: [e.chave, detalhe].filter(Boolean).join(': ') }
    case 'human_checkpoint': return { tipo: 'checkpoint', ts: e.ts, estado: e.chave ?? '', aberto: e.resultado === 'aberto', detalhe }
    default: return { tipo: 'evento', ts: e.ts, evento: e.evento, detalhe: [e.chave, detalhe].filter(Boolean).join(': ') }
  }
}

export function linhaDoTempo(f: FontesDaLinha): Marco[] {
  const chamadas = casarComLedger(blocosDeChamada(f.atividades), f.chamadas)
  const marcos: Marco[] = [...f.eventos.map(marcoDoEvento), ...trocasNaLinha(f.chamadas), ...chamadas]
  return marcos
    .map((m, i) => ({ m, i }))
    .sort((a, b) => a.m.ts.localeCompare(b.m.ts) || a.i - b.i)
    .map(x => x.m)
}

export function chamadasEmVoo(marcos: readonly Marco[]): ChamadaNaLinha[] {
  return marcos.filter((m): m is ChamadaNaLinha => m.tipo === 'chamada' && !m.concluida)
}

export function harnessAtual(chamadas: readonly ChamadaDeIa[]): { provedor: string; modelo: string; trocas: number } {
  const ordenadas = [...chamadas].sort((a, b) => a.ts.localeCompare(b.ts))
  const ultima = ordenadas[ordenadas.length - 1]
  return { provedor: ultima?.provedor ?? '', modelo: ultima?.modelo ?? '', trocas: trocasNaLinha(chamadas).length }
}
