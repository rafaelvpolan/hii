// A pasta versionada ia/claude troca o ~/.claude pessoal no Claude do motor. O
// papel de cada chamada decide o quanto da conta pessoal ainda vale: nada na
// leitura, so o projeto-alvo na escrita, a conta inteira (sem hooks, Skill nem
// slash) no recuo do modo conta.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { servidoresMcpDoClaude } from '../../euclides/tesouro/planos.ts'
import type { DefinicaoDeServidorMcp, ServidoresMcpDoClaude } from '../../euclides/tesouro/planos.ts'
import { MCP_PREFIX, combinam, prefixoDe } from '../ponte/estado.ts'
import type { AgentRequest } from '../tipos.ts'

export const PASTA_DO_CLAUDE = fileURLToPath(new URL('../../../ia/claude', import.meta.url))

export type PapelDoClaude = 'leitura' | 'escrita' | 'conta'

export interface OpcoesDaPasta {
  env?: NodeJS.ProcessEnv
}

type ValorJson = null | boolean | number | string | ValorJson[] | { [chave: string]: ValorJson }
type ObjetoJson = { [chave: string]: ValorJson }

// Mesma lista de baseToolsFor em claude-argv.ts; repetida para nao criar ciclo
// de import entre o argv e a pasta.
const FERRAMENTAS_DE_LEITURA = ['Read', 'Glob', 'Grep']
const FERRAMENTAS_DE_ESCRITA = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash']

const ARQUIVOS_DA_VERSAO = ['regras.md', 'settings.json', 'mcp.json']

const REGRAS = join(PASTA_DO_CLAUDE, 'regras.md')

function objeto(v: ValorJson | undefined): ObjetoJson {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
}

// Ausente vale como vazio; ilegivel lanca, porque settings.json carrega as
// negacoes do motor e perde-las em silencio seria liberar o que ele proibe.
function lerJsonDaPasta(nome: string): ObjetoJson {
  const caminho = join(PASTA_DO_CLAUDE, nome)
  if (!existsSync(caminho)) return {}
  try {
    return objeto(JSON.parse(readFileSync(caminho, 'utf8')) as ValorJson)
  } catch (e) {
    throw new Error(`${caminho} ilegivel: ${String((e as Error).message)}`)
  }
}

function servidoresDeclarados(): string[] {
  const lista = lerJsonDaPasta('mcp.json').servidores
  return Array.isArray(lista) ? lista.filter((s): s is string => typeof s === 'string' && !!s) : []
}

function pertence(tool: string, servidor: string): boolean {
  const prefixo = prefixoDe(servidor)
  return tool === prefixo || tool.startsWith(prefixo + '__')
}

const avisados = new Set<string>()

function avisar(motivo: string): void {
  if (avisados.has(motivo)) return
  avisados.add(motivo)
  process.stderr.write(`[hicode] Claude no modo conta (${motivo}) — o MCP da conta pessoal vale nesta chamada, sem hooks, Skill nem slash\n`)
}

function motivoDoRecuo(tool: string, declarado: string, config: ServidoresMcpDoClaude): string {
  if (config.falhou) return `config do Claude: ${config.falhou}`
  const recusado = Object.keys(config.recusados).find(k => combinam(declarado, k) && pertence(tool, k))
  if (recusado !== undefined) return `servidor ${recusado} ${config.recusados[recusado]} no mcpServers, credencial que o motor nao leva para o argv`
  return `servidor ${declarado} declarado em ia/claude/mcp.json sem definicao legivel no mcpServers`
}

interface Resolucao {
  readonly papel: PapelDoClaude
  readonly servidores: Readonly<Record<string, DefinicaoDeServidorMcp>>
}

// Recalculado a cada chamada: retentativa ve a config do momento.
function resolver(req: AgentRequest): Resolucao {
  if (req.mode !== 'edit') return { papel: 'leitura', servidores: {} }
  const tools = (req.extraTools ?? []).filter(t => t.startsWith(MCP_PREFIX))
  if (!tools.length) return { papel: 'escrita', servidores: {} }
  const declarados = servidoresDeclarados()
  const config = servidoresMcpDoClaude()
  const candidatos = Object.keys(config.definicoes).filter(k => declarados.some(d => combinam(d, k)))
  const usados: Record<string, DefinicaoDeServidorMcp> = {}
  for (const tool of tools) {
    // A tool tem de pertencer ao prefixo de um servidor declarado: combinam e
    // por substring, e sem isto um servidor pessoal "omcloud" entrava no
    // --mcp-config da escrita so por conter "omc" no nome.
    const declarado = declarados.find(d => pertence(tool, d))
    const chave = declarado === undefined ? undefined : candidatos.find(k => pertence(tool, k))
    const definicao = chave === undefined ? undefined : config.definicoes[chave]
    if (chave !== undefined && definicao) { usados[chave] = definicao; continue }
    // Declarado sem definicao legivel nao some: a tool continua no
    // --allowedTools e no --agents, e com MCP estrito ela nao existiria.
    // Autenticado por headers/oauth tambem cai aqui: a lista branca nao leva a
    // credencial, e sem ela a tool falharia no meio da execucao.
    if (declarado) avisar(motivoDoRecuo(tool, declarado, config))
    return { papel: 'conta', servidores: {} }
  }
  return { papel: 'escrita', servidores: usados }
}

export function papelDoClaude(req: AgentRequest): PapelDoClaude {
  return resolver(req).papel
}

function ferramentas(papel: PapelDoClaude, req: AgentRequest): string {
  if (papel === 'leitura') return FERRAMENTAS_DE_LEITURA.join(',')
  const base = req.useAgents ? ['Task', ...FERRAMENTAS_DE_ESCRITA] : FERRAMENTAS_DE_ESCRITA
  return (papel === 'escrita' ? [...base, 'Skill'] : base).join(',')
}

function settingsInline(papel: PapelDoClaude, env: NodeJS.ProcessEnv | undefined): string {
  const settings: ObjetoJson = { ...lerJsonDaPasta('settings.json') }
  if (papel !== 'escrita') settings.disableAllHooks = true
  if (env) {
    const pares: Record<string, string> = {}
    for (const [k, v] of Object.entries(env)) if (v !== undefined) pares[k] = v
    settings.env = { ...objeto(settings.env), ...pares }
  }
  return JSON.stringify(settings)
}

const FONTES_DE_SETTINGS: Readonly<Record<PapelDoClaude, string>> = {
  leitura: '',
  escrita: 'project,local',
  conta: 'user,project,local',
}

export function argumentosDaPasta(req: AgentRequest, opcoes: OpcoesDaPasta = {}): string[] {
  const { papel, servidores } = resolver(req)
  const a = [
    '--tools', ferramentas(papel, req),
    '--setting-sources', FONTES_DE_SETTINGS[papel],
    '--settings', settingsInline(papel, opcoes.env),
  ]
  if (papel !== 'conta') a.push('--strict-mcp-config')
  if (Object.keys(servidores).length) a.push('--mcp-config', JSON.stringify({ mcpServers: servidores }))
  if (papel !== 'escrita') a.push('--disable-slash-commands')
  a.push('--no-session-persistence', '--append-system-prompt-file', REGRAS)
  return a
}

// Sem memo: o pacote aprovado tem de refletir a pasta do momento.
export function versaoDaPasta(pasta: string = PASTA_DO_CLAUDE): string {
  const dirComandos = join(pasta, 'comandos')
  let comandos: string[] = []
  try { comandos = readdirSync(dirComandos).filter(n => n.endsWith('.md')).sort() } catch { comandos = [] }
  const hash = createHash('sha256')
  for (const relativo of [...ARQUIVOS_DA_VERSAO, ...comandos.map(n => join('comandos', n))]) {
    const caminho = join(pasta, relativo)
    hash.update(relativo).update('\0')
    hash.update(existsSync(caminho) ? readFileSync(caminho) : '').update('\0')
  }
  return hash.digest('hex').slice(0, 16)
}
