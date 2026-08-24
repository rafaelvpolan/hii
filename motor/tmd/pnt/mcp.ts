import { run } from '../../qlb/git.ts'
import { lerListaDeServidores, lerEscopo, disponibilidadeExterna } from './estado.ts'
import type { DisponibilidadeExterna, EscopoDaConsulta, ListaDeServidores } from './estado.ts'
import { harnessPorNome, providerNames } from '../registro.ts'

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

function primeiraLinha(texto: string): string {
  return String(texto || '').split('\n').map(l => l.trim()).filter(Boolean)[0]?.slice(0, 160) ?? ''
}

async function servidoresComEstado(): Promise<ListaDeServidores> {
  const bin = binarioComMcp()
  // Nenhum provedor declara `mcp` em capabilities: nao ha o que listar, e isso e
  // fato conhecido, nao falha.
  if (!bin) return { servidores: [], falhou: '' }
  try {
    const { err, stdout, stderr } = await run(bin, ['mcp', 'list'], { timeout: MCP_LIST_TIMEOUT_MS })
    if (err) {
      return { servidores: [], falhou: `"${bin} mcp list" falhou: ${primeiraLinha(stderr) || err.message}` }
    }
    return { servidores: lerListaDeServidores(stdout), falhou: '' }
  } catch (e) {
    return { servidores: [], falhou: `nao consegui executar "${bin} mcp list": ${String((e as Error).message)}` }
  }
}

// Mesma distincao da listagem, aplicada ao escopo: "o binario nao respondeu" e
// "respondeu e nao tem linha de scope" nao podem ter o mesmo valor. O primeiro e
// transitorio; colapsar os dois em 'nao-verificavel' fazia um timeout de
// `claude mcp get` virar HALT sem retry.
async function escopoDe(nome: string): Promise<EscopoDaConsulta> {
  const bin = binarioComMcp()
  if (!bin) return { escopo: 'nao-verificavel', falhou: '' }
  try {
    const { err, stdout, stderr } = await run(bin, ['mcp', 'get', nome], { timeout: MCP_LIST_TIMEOUT_MS })
    if (err) return { escopo: 'nao-verificavel', falhou: `"${bin} mcp get ${nome}" falhou: ${primeiraLinha(stderr) || err.message}` }
    return { escopo: lerEscopo(stdout), falhou: '' }
  } catch (e) {
    return { escopo: 'nao-verificavel', falhou: `nao consegui executar "${bin} mcp get ${nome}": ${String((e as Error).message)}` }
  }
}

let estadoCache: Promise<ListaDeServidores> | undefined
let estadoEm = 0
const TTL_ESTADO_MS = 60_000

export async function conectorExterno(ferramenta: string): Promise<DisponibilidadeExterna> {
  const agora = Date.now()
  if (!estadoCache || agora - estadoEm > TTL_ESTADO_MS) {
    estadoCache = servidoresComEstado()
    estadoEm = agora
  }
  const lista = await estadoCache
  // Falha de listagem NAO fica no cache por 60s: guardar "nao consegui listar"
  // faria um hiccup de 20s virar um minuto de card parado.
  //
  // A limpeza vem DEPOIS de resolver, e o closure abaixo devolve o valor JA
  // RESOLVIDO. Ler `estadoCache` dentro do closure era ler a variavel de modulo
  // no momento da chamada — ja `undefined` —, e `disponibilidadeExterna` fazia
  // `await consulta.servidores()` virar `undefined` e estourar TypeError em
  // `lista.falhou`. Ou seja: exatamente no caso que este tratamento existe para
  // cobrir, a funcao explodia, e a excecao subia sem retry ate o card HALTar.
  if (lista.falhou) estadoCache = undefined
  return disponibilidadeExterna(ferramenta, {
    servidores: () => Promise.resolve(lista),
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

// Antes o conserto da listagem, a falha ESTOURAVA (visivel demais: derrubava o
// card). Agora devolve indisponivel — e sem esta linha isso viraria perda de
// capacidade INVISIVEL: o passo perde todas as tools de navegacao semantica sem
// nada em lugar nenhum. Uma vez por motivo, como os outros avisos do repo.
const navegacaoAvisada = new Set<string>()

export async function navegacaoSemantica(): Promise<string[]> {
  const conector = await conectorExterno(SERVIDOR_NAVEGACAO)
  if (!conector.usavel && conector.transitorio && !navegacaoAvisada.has(conector.motivo)) {
    navegacaoAvisada.add(conector.motivo)
    process.stderr.write(`[hicode] sem navegacao semantica neste passo (${conector.motivo}) — o agente vai trabalhar sem lsp/ast-grep; isso NAO e o mesmo que o conector nao existir\n`)
  }
  return ferramentasDeNavegacao(conector)
}

export function esquecerAvisosDeNavegacao(): void {
  navegacaoAvisada.clear()
}
