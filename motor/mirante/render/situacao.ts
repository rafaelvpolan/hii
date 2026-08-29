import { relatoDeTempo } from './tempo-do-card.ts'
import type { Fields } from '../../cordel/index.ts'
import type { EventoDoCard } from '../../euclides/eventos.ts'
import type { Atividade } from '../atividade.ts'
import { truncVisible } from '../tui/layout.ts'

// MIR — "o que esta acontecendo AGORA", numa tela.
//
// Nasceu de duas queixas que sao a mesma: (1) perguntar dentro da tarefa nao
// respondia nada — o texto virava instrucao anexada ao card; (2) a area de execucao
// mostrava o que a IA fazia (Read, Edit, Task) mas nada do que o MOTOR decidia:
// perfil escolhido, agentes injetados, skills que casaram, escopo, gate, tentativa
// N/M do laco de reparo. Isso vivia no diario do card, que ninguem abre no meio do
// trabalho.
//
// Uma fonte, dois consumidores: a resposta da pergunta e o cabecalho da tarefa.

const DIM = '\x1b[2m'
const RESET = '\x1b[0m'
const CYAN = '\x1b[36m'
const WARN = '\x1b[33m'
const RED = '\x1b[31m'

export interface OpcoesDaSituacao {
  color: boolean
  width: number
  // Campos a NAO repetir. O cabecalho fixo da tarefa ja mostra agente e ultima
  // acao pelo renderProcessos; repetir ali seria ocupar linha fixa com o que ja
  // esta na tela.
  omitir: readonly string[]
  // `false` deixa de fora a linha de titulo (#id STATUS titulo), que o cabecalho
  // da tarefa tambem ja tem.
  cabecalho: boolean
}

const PADRAO: OpcoesDaSituacao = { color: false, width: 78, omitir: [], cabecalho: true }

export interface Situacao {
  readonly fm: Fields
  readonly eventos: readonly EventoDoCard[]
  readonly atividades: readonly Atividade[]
  // Arquivos que o diff do worktree mostra. Quem chama le do git; este modulo e puro.
  readonly tocados: readonly string[]
}

function paint(s: string, code: string, o: OpcoesDaSituacao): string {
  return o.color ? `${code}${s}${RESET}` : s
}

function campo(nome: string, valor: string, o: OpcoesDaSituacao): string {
  return `    ${paint(nome.padEnd(11), DIM, o)} ${truncVisible(valor, Math.max(20, o.width - 18))}`
}

// A ultima tentativa de reparo de cada fase: "tentativa 2/3" e o que o humano quer
// saber quando pergunta "e ai?".
function tentativas(eventos: readonly EventoDoCard[]): string {
  const ultima = [...eventos].reverse().find(e => e.evento === 'repair_attempt')
  return ultima ? `${ultima.fase ?? ''} — ${ultima.detalhe ?? ''}` : ''
}

function faseAberta(eventos: readonly EventoDoCard[]): string {
  const abertas: string[] = []
  for (const e of eventos) {
    if (e.evento === 'fase_inicio') abertas.push(e.fase ?? '')
    if (e.evento === 'fase_fim') abertas.pop()
  }
  return abertas[abertas.length - 1] ?? ''
}

function gate(eventos: readonly EventoDoCard[]): string {
  const ultimo = [...eventos].reverse().find(e => e.evento === 'gate_verdict')
  return ultimo ? `${ultimo.fase ?? 'gate'}: ${ultimo.detalhe ?? ''}` : ''
}

function skills(atividades: readonly Atividade[]): string {
  const nomes = [...new Set(atividades.filter(a => a.tipo === 'skill').map(a => a.nome))]
  return nomes.join(', ')
}

function agentes(atividades: readonly Atividade[]): string {
  const nomes = [...new Set(atividades.filter(a => a.tipo === 'agente').map(a => a.nome))]
  return nomes.join(' → ')
}

function ultimaFerramenta(atividades: readonly Atividade[]): string {
  const util = atividades.filter(a => ['arquivo', 'shell', 'busca', 'mcp'].includes(a.tipo))
  const u = util[util.length - 1]
  return u ? `${u.nome} ${u.alvo}` : ''
}

// Cada linha so aparece se tiver conteudo: tela com campo vazio treina o olho a
// ignorar a tela.
export function renderSituacao(s: Situacao, opts: Partial<OpcoesDaSituacao> = {}): string[] {
  const o = { ...PADRAO, ...opts }
  const fm = s.fm
  const linhas: string[] = []
  const id = String(fm.id ?? '')
  if (o.cabecalho) {
    linhas.push(`  ${paint(`#${id.padStart(3, '0')}`, CYAN, o)} ${paint(String(fm.status ?? '?'), WARN, o)}  ${truncVisible(String(fm.title ?? ''), Math.max(20, o.width - 24))}`)
  }

  const pares: Array<[string, string]> = [
    ['perfil', String(fm.steps_profile ?? '')],
    ['escreve em', String(fm.escopo_alvos ?? '')],
    ['so le', String(fm.escopo_refs ?? '')],
    ['fase', faseAberta(s.eventos)],
    ['agentes', agentes(s.atividades)],
    ['skills', skills(s.atividades)],
    ['ultima acao', ultimaFerramenta(s.atividades)],
    ['reparo', tentativas(s.eventos)],
    ['gate', gate(s.eventos)],
    ['crivo', String(fm.crivo_modo ?? '')],
    ['gasto', fm.cost_usd ? `US$${fm.cost_usd} · ${fm.tokens_total ?? '0'} tokens` : ''],
    ['tempo', relatoDeTempo(fm, Date.now())],
    ['espera', fm.wait_reason ? `${fm.wait_reason} (tentativa ${fm.wait_attempts ?? '?'})` : ''],
  ]
  for (const [nome, valor] of pares) {
    if (o.omitir.includes(nome)) continue
    if (valor.trim()) linhas.push(campo(nome, valor, o))
  }

  // ESCOPO e o campo que existe por causa do incidente: o agente escreveu no
  // projeto de referencia. Aqui o humano ve, no meio do trabalho, onde ele pode
  // escrever — e se ja violou.
  if (fm.escopo_violado) {
    // Rotulo dentro da mesma largura de coluna dos outros: rotulo mais longo
    // desalinha a tabela inteira, e a linha que mais importa e a que fica torta.
    linhas.push(`    ${paint('FORA ESCOPO', RED, o)} ${truncVisible(String(fm.escopo_violado), Math.max(20, o.width - 18))}`)
  }
  if (s.tocados.length) {
    linhas.push(campo('tocou', `${s.tocados.length} arquivo(s): ${s.tocados.slice(0, 4).join(', ')}${s.tocados.length > 4 ? ` +${s.tocados.length - 4}` : ''}`, o))
  }
  return linhas
}
