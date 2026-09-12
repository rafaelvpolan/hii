import { linhasDaAtividade } from './render/execucao.ts'

export type TipoAtividade = 'sessao' | 'agente' | 'skill' | 'arquivo' | 'shell' | 'busca' | 'mcp' | 'texto' | 'fim'

export interface Atividade {
  tipo: TipoAtividade
  nome: string
  alvo: string
  ts: string
  args?: string
  resultado?: string
  raia?: string
}

export interface EntradaFerramenta {
  subagent_type?: string
  skill?: string
  name?: string
  description?: string
  prompt?: string
  args?: string
  file_path?: string
  path?: string
  notebook_path?: string
  command?: string
  pattern?: string
  query?: string
  url?: string
}

export interface EventoBruto {
  ferramenta: string
  entrada: EntradaFerramenta
}

const ARQUIVO = ['Read', 'Edit', 'Write', 'NotebookEdit', 'MultiEdit']
const BUSCA = ['Grep', 'Glob', 'WebSearch', 'WebFetch']
const CHAVES: Array<keyof EntradaFerramenta> = [
  'subagent_type', 'skill', 'name', 'description', 'prompt', 'args',
  'file_path', 'path', 'notebook_path', 'command', 'pattern', 'query', 'url',
]

function curto(s: string | undefined, max = 60): string {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

function base(caminho: string | undefined): string {
  return String(caminho ?? '').split('/').slice(-2).join('/')
}

export function classificar(ev: EventoBruto, ts = ''): Atividade {
  const f = ev.ferramenta
  const e = ev.entrada
  if (f === 'Task') {
    return { tipo: 'agente', nome: e.subagent_type || e.description || 'agente', alvo: curto(e.description || e.prompt), ts }
  }
  if (f === 'Skill') {
    return { tipo: 'skill', nome: e.skill || e.name || 'skill', alvo: curto(e.args), ts }
  }
  if (ARQUIVO.includes(f)) {
    return { tipo: 'arquivo', nome: f.toLowerCase(), alvo: base(e.file_path || e.path || e.notebook_path), ts }
  }
  if (f === 'Bash') {
    return { tipo: 'shell', nome: 'bash', alvo: curto(e.command || e.description), ts }
  }
  if (BUSCA.includes(f)) {
    return { tipo: 'busca', nome: f.toLowerCase(), alvo: curto(e.pattern || e.query || e.url), ts }
  }
  if (f.startsWith('mcp__')) {
    const partes = f.split('__')
    const args = curto(e.query || e.url || e.pattern || e.description || e.args)
    return { tipo: 'mcp', nome: partes[1] ?? 'mcp', alvo: partes[2] ?? '', ts, ...(args ? { args } : {}) }
  }
  return { tipo: 'texto', nome: f, alvo: curto(e.description || e.prompt || e.query || e.pattern || e.args), ts }
}

const RE_TOOL = /^\s*→\s*([A-Za-z_][\w.-]*)\((.*)$/
const RE_SESSAO = /^—\s*sessao iniciada(?:\s*\(([^)]+)\))?/
const RE_CHAMADA = /^—\s*chamada em (\S+)(?:\s*·\s*([^—]+?))?\s*—?\s*$/
const RE_FIM = /^—\s*concluido(?: \(custo \$([0-9.]+)\))?/
const RE_RAIA = /^\[([^\]]{1,40})\] (.*)$/
const RE_TIMEOUT = /^—\s*TIMEOUT/

function entradaDe(bruto: string): EntradaFerramenta {
  const limpo = bruto.replace(/…$/, '')
  try {
    const j = JSON.parse(limpo) as EntradaFerramenta
    const out: EntradaFerramenta = {}
    for (const k of CHAVES) {
      const v = j[k]
      if (typeof v === 'string') out[k] = v
    }
    return out
  } catch {
    const out: EntradaFerramenta = {}
    for (const k of CHAVES) {
      const m = limpo.match(new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`))
      if (m?.[1]) out[k] = desescapar(m[1])
    }
    return out
  }
}

function desescapar(s: string): string {
  return s.replace(/\\(["\\/])/g, '$1').replace(/\\[nrt]/g, ' ')
}

export function separarRaia(linha: string): { raia: string; linha: string } {
  const m = linha.match(RE_RAIA)
  return m ? { raia: m[1] ?? '', linha: m[2] ?? '' } : { raia: '', linha }
}

export function parseLinha(bruta: string, ts = ''): Atividade | null {
  const { raia, linha } = separarRaia(bruta)
  const a = parseLinhaSemRaia(linha, ts)
  return a && raia ? { ...a, raia } : a
}

function parseLinhaSemRaia(linha: string, ts = ''): Atividade | null {
  const chamada = linha.match(RE_CHAMADA)
  if (chamada) return { tipo: 'sessao', nome: 'chamada', alvo: '', ts: chamada[1] ?? ts, args: (chamada[2] ?? '').trim() }
  const sessao = linha.match(RE_SESSAO)
  if (sessao) return { tipo: 'sessao', nome: 'sessao', alvo: sessao[1] ?? '', ts }
  const fim = linha.match(RE_FIM)
  if (fim) return { tipo: 'fim', nome: 'concluido', alvo: fim[1] ? `US$${fim[1]}` : '', ts }
  if (RE_TIMEOUT.test(linha)) return { tipo: 'fim', nome: 'timeout', alvo: '', ts }
  const tool = linha.match(RE_TOOL)
  if (tool?.[1]) {
    const bruto = (tool[2] ?? '').replace(/\)\s*$/, '')
    return classificar({ ferramenta: tool[1], entrada: entradaDe(bruto) }, ts)
  }
  if (linha.trimStart().startsWith('←')) return null
  const texto = linha.trimEnd()
  return texto.trim() ? { tipo: 'texto', nome: '', alvo: texto, ts } : null
}

export function ehProsa(a: Atividade): boolean {
  return a.tipo === 'texto' && !a.nome
}

export function ehFerramenta(a: Atividade): boolean {
  return a.tipo !== 'sessao' && a.tipo !== 'fim' && !ehProsa(a)
}

function lerResultado(linha: string): string | null {
  const t = linha.trimStart()
  return t.startsWith('←') ? t.slice(1).trim() : null
}

function mesmaRaia(a: Atividade, b: Atividade): boolean {
  return (a.raia ?? '') === (b.raia ?? '')
}

export function parseLog(conteudo: string): Atividade[] {
  const saida: Atividade[] = []
  const esperandoResultado = new Map<string, Atividade[]>()
  const ultimaDaRaia = new Map<string, Atividade>()
  for (const bruta of conteudo.split('\n')) {
    const { raia, linha } = separarRaia(bruta)
    const resultado = lerResultado(linha)
    const ultima = ultimaDaRaia.get(raia)
    if (resultado !== null) {
      const dono = esperandoResultado.get(raia)?.shift()
      if (dono) dono.resultado = resultado
      continue
    }
    const a = parseLinha(bruta)
    if (!a) {
      if (!linha.trim() && ultima && ehProsa(ultima)) ultima.alvo = `${ultima.alvo}\n`
      continue
    }
    if (ultima && ehProsa(ultima) && ehProsa(a) && mesmaRaia(ultima, a)) {
      ultima.alvo = `${ultima.alvo}\n${a.alvo}`
      continue
    }
    if (ultima?.nome === 'chamada' && a.nome === 'sessao' && mesmaRaia(ultima, a)) {
      ultima.nome = 'sessao'
      ultima.alvo = a.alvo
      continue
    }
    if (ehFerramenta(a)) {
      const fila = esperandoResultado.get(raia) ?? []
      fila.push(a)
      esperandoResultado.set(raia, fila)
    }
    saida.push(a)
    ultimaDaRaia.set(raia, a)
  }
  return saida
}

function corLigada(): boolean {
  return process.stdout.isTTY === true && !process.env.NO_COLOR
}

export function formatar(a: Atividade): string {
  return linhasDaAtividade(a, { color: corLigada() }).join('\n')
}

export function agentesUsados(atividades: Atividade[]): string[] {
  return [...new Set(atividades.filter(a => a.tipo === 'agente').map(a => a.nome))]
}

export function ultimoAgente(atividades: Atividade[]): string {
  const so = atividades.filter(a => a.tipo === 'agente')
  return so[so.length - 1]?.nome ?? ''
}

export function ultimaAcao(atividades: Atividade[]): string {
  const uteis = atividades.filter(a => a.tipo !== 'texto' && a.tipo !== 'sessao' && a.tipo !== 'fim')
  const ultima = uteis[uteis.length - 1]
  if (!ultima) return ''
  const alvo = ultima.alvo ? ` ${ultima.alvo.split('/').pop() ?? ultima.alvo}` : ''
  return `${ultima.nome}${alvo}`.slice(0, 40)
}

export function resumo(atividades: Atividade[]): string {
  const conta = (t: TipoAtividade): number => atividades.filter(a => a.tipo === t).length
  const agentes = agentesUsados(atividades)
  return [
    agentes.length ? agentes.join(', ') : '',
    conta('skill') ? `${conta('skill')} skill(s)` : '',
    conta('arquivo') ? `${conta('arquivo')} arquivo(s)` : '',
    conta('shell') ? `${conta('shell')} comando(s)` : '',
    conta('busca') ? `${conta('busca')} busca(s)` : '',
  ].filter(Boolean).join(' · ')
}
