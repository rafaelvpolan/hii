import { run } from '../../qlb/git'
import { lerListaDeServidores, lerEscopo, disponibilidadeExterna } from './estado'
import type { ServidorMcp, EscopoServidor, DisponibilidadeExterna } from './estado'
import { harnessPorNome, providerNames } from '../registro'

const MCP_PREFIX = 'mcp__'
const MCP_LIST_TIMEOUT_MS = 20000

export function prefixoDe(servidor: string): string {
  return `${MCP_PREFIX}${servidor.replace(/[^a-zA-Z0-9]+/g, '_')}`
}

function normalizar(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function servidoresPara(ferramenta: string, servidores: string[]): string[] {
  const alvo = normalizar(ferramenta ?? '').trim()
  if (!alvo) return []
  return servidores.filter(servidor => normalizar(servidor).includes(alvo))
}

// Quem fala MCP e quem DECLARA mcp em capabilities — nao um nome fixo aqui.
function binarioComMcp(): string {
  const nome = providerNames().find(n => harnessPorNome(n).capabilities().mcp)
  return nome ? harnessPorNome(nome).binario : ''
}

async function servidoresComEstado(): Promise<ServidorMcp[]> {
  const bin = binarioComMcp()
  if (!bin) return []
  try {
    const { err, stdout } = await run(bin, ['mcp', 'list'], { timeout: MCP_LIST_TIMEOUT_MS })
    if (err) return []
    return lerListaDeServidores(stdout)
  } catch {
    return []
  }
}

async function escopoDe(nome: string): Promise<EscopoServidor> {
  const bin = binarioComMcp()
  if (!bin) return 'nao-verificavel'
  try {
    const { err, stdout } = await run(bin, ['mcp', 'get', nome], { timeout: MCP_LIST_TIMEOUT_MS })
    if (err) return 'nao-verificavel'
    return lerEscopo(stdout)
  } catch {
    return 'nao-verificavel'
  }
}

let estadoCache: Promise<ServidorMcp[]> | undefined
let estadoEm = 0
const TTL_ESTADO_MS = 60_000

export async function conectorExterno(ferramenta: string): Promise<DisponibilidadeExterna> {
  const agora = Date.now()
  if (!estadoCache || agora - estadoEm > TTL_ESTADO_MS) {
    estadoCache = servidoresComEstado()
    estadoEm = agora
  }
  return disponibilidadeExterna(ferramenta, {
    servidores: () => estadoCache as Promise<ServidorMcp[]>,
    escopo: escopoDe,
    prefixo: prefixoDe,
  })
}

export const SERVIDOR_NAVEGACAO = 'omc'

export const TOOLS_NAVEGACAO: readonly string[] = [
  'lsp_servers',
  'lsp_hover',
  'lsp_goto_definition',
  'lsp_find_references',
  'lsp_document_symbols',
  'lsp_workspace_symbols',
  'lsp_diagnostics',
  'lsp_diagnostics_directory',
  'ast_grep_search',
]

export function ferramentasDeNavegacao(disponibilidade: DisponibilidadeExterna): string[] {
  if (!disponibilidade.usavel) return []
  return disponibilidade.tools.flatMap(prefixo => TOOLS_NAVEGACAO.map(tool => `${prefixo}__${tool}`))
}

export async function navegacaoSemantica(): Promise<string[]> {
  return ferramentasDeNavegacao(await conectorExterno(SERVIDOR_NAVEGACAO))
}
