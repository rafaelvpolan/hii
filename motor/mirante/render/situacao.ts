import { relatoDeTempo } from './tempo-do-card.ts'
import type { Fields } from '../../cordel/index.ts'
import type { EventoDoCard } from '../../euclides/eventos.ts'
import type { Atividade } from '../atividade.ts'
import type { ChamadaDeIa } from '../../cordel/tipos.ts'
import { harnessAtual } from '../../euclides/linha-do-tempo.ts'
import { WAITING_HUMAN } from './phases.ts'
import { truncVisible } from '../tui/layout.ts'

// Mirante — "o que esta acontecendo AGORA", numa tela.
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
  // Ledger de chamadas do card: de onde saem provedor/modelo atuais e as trocas.
  readonly chamadas?: readonly ChamadaDeIa[]
  // Rotulos (ou raias) das chamadas de IA ainda sem conclusao no live log.
  readonly emVoo?: readonly string[]
  // Candidatos da comparacao cega quando o crivo esta em gauntlet (tela + referencias).
  readonly candidatos?: number
  readonly agoraMs?: number
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

function harness(chamadas: readonly ChamadaDeIa[] | undefined): string {
  if (!chamadas?.length) return ''
  const h = harnessAtual(chamadas)
  const trocas = h.trocas ? ` · ${h.trocas} troca${h.trocas > 1 ? 's' : ''} de provedor` : ''
  return `${[h.provedor, h.modelo].filter(Boolean).join(' ')}${trocas}`
}

function emVoo(rotulos: readonly string[] | undefined): string {
  if (!rotulos?.length) return ''
  return rotulos.length === 1 ? String(rotulos[0]) : `${rotulos.length} chamadas: ${rotulos.join(', ')}`
}

function crivo(fm: Fields, candidatos: number | undefined): string {
  const modo = String(fm.crivo_modo ?? '')
  return modo === 'gauntlet' && candidatos ? `gauntlet · ${candidatos} candidatos cegos` : modo
}

const PARADO = new Set([...WAITING_HUMAN, 'PAUSED', 'WAITING'])

function duracaoCurta(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}min`
  if (s < 86400) return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`
}

// A pendencia registrada: o dado (status_since) existia e ninguem o desenhava.
// Card esperando gente ha dias e card que parou agora sao coisas diferentes.
function paradoHa(fm: Fields, agoraMs: number): string {
  const status = String(fm.status ?? '')
  if (!PARADO.has(status)) return ''
  const desde = Date.parse(String(fm.status_since ?? ''))
  if (Number.isNaN(desde)) return ''
  return `${duracaoCurta(agoraMs - desde)} em ${status}`
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
    ['crivo', crivo(fm, s.candidatos)],
    ['harness', harness(s.chamadas)],
    ['em voo', emVoo(s.emVoo)],
    ['gasto', fm.cost_usd ? `US$${fm.cost_usd} · ${fm.tokens_total ?? '0'} tokens` : ''],
    ['tempo', relatoDeTempo(fm, s.agoraMs ?? Date.now())],
    ['parado ha', paradoHa(fm, s.agoraMs ?? Date.now())],
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
