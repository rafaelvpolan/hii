import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../cordel/alicerce/config.ts'
import { ENV_AGENTS_DIR } from '../cordel/alicerce/contrato.ts'
import { memoTempo } from '../tomada/eco/memo.ts'

export interface AgenteInjetado {
  description: string
  prompt: string
  model?: string
  // Array, nao a string crua do frontmatter: o --agents do claude CLI valida o
  // JSON e recusa tools em string ("expected array, received string" — erro que
  // derrubou um card inteiro no restart). O .md no disco continua com a lista
  // em string, que e o formato do Claude Code; a conversao e na borda, aqui.
  tools?: string[]
}

const TTL_MS = 30_000

export function diretorioDosAgentes(): string {
  return process.env[ENV_AGENTS_DIR] || join(ROOT, '.claude', 'agents')
}

function semAspas(valor: string): string {
  const t = valor.trim()
  if (t.length > 1 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
    return t.slice(1, -1)
  }
  return t
}

export interface AgenteLido {
  nome: string
  agente: AgenteInjetado
}

export function lerAgente(texto: string): AgenteLido | null {
  const m = texto.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return null
  const campos = new Map<string, string>()
  for (const linha of (m[1] ?? '').split('\n')) {
    const i = linha.indexOf(':')
    if (i <= 0) continue
    campos.set(linha.slice(0, i).trim(), semAspas(linha.slice(i + 1)))
  }
  const nome = campos.get('name') ?? ''
  const description = campos.get('description') ?? ''
  const prompt = (m[2] ?? '').trim()
  if (!nome || !description || !prompt) return null
  const agente: AgenteInjetado = { description, prompt }
  const model = campos.get('model')
  const tools = campos.get('tools')
  if (model) agente.model = model
  if (tools) agente.tools = tools.split(',').map(t => t.trim()).filter(t => t.length > 0)
  return { nome, agente }
}

function lerDoDiretorio(dir: string): Record<string, AgenteInjetado> {
  if (!existsSync(dir)) return {}
  const out: Record<string, AgenteInjetado> = {}
  for (const arquivo of readdirSync(dir)) {
    if (!arquivo.endsWith('.md')) continue
    try {
      const lido = lerAgente(readFileSync(join(dir, arquivo), 'utf8'))
      if (lido) out[lido.nome] = lido.agente
    } catch {
      continue
    }
  }
  return out
}

const memorizadoPorDiretorio = new Map<string, () => Record<string, AgenteInjetado>>()

function memorizadoDe(dir: string): () => Record<string, AgenteInjetado> {
  const existente = memorizadoPorDiretorio.get(dir)
  if (existente) return existente
  const memo = memoTempo(() => lerDoDiretorio(dir), TTL_MS)
  memorizadoPorDiretorio.set(dir, memo)
  return memo
}

export function agentesNexus(): Record<string, AgenteInjetado> {
  return memorizadoDe(diretorioDosAgentes())()
}

export function agentesNexusJson(): string {
  const agentes = agentesNexus()
  return Object.keys(agentes).length ? JSON.stringify(agentes) : ''
}

function comFerramentasExtra(agente: AgenteInjetado, extras: readonly string[]): AgenteInjetado {
  if (!extras.length || !agente.tools) return agente
  return { ...agente, tools: Array.from(new Set([...agente.tools, ...extras])) }
}

export function agentesNexusPor(nomes: readonly string[], ferramentasExtra: readonly string[] = []): Record<string, AgenteInjetado> {
  const todos = agentesNexus()
  const escolhidos: Record<string, AgenteInjetado> = {}
  for (const nome of nomes) {
    const agente = todos[nome]
    if (agente) escolhidos[nome] = comFerramentasExtra(agente, ferramentasExtra)
  }
  return escolhidos
}

export function agentesNexusJsonPor(nomes: readonly string[], ferramentasExtra: readonly string[] = []): string {
  const escolhidos = agentesNexusPor(nomes, ferramentasExtra)
  return Object.keys(escolhidos).length ? JSON.stringify(escolhidos) : ''
}
