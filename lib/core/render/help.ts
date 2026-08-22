import { PHASES } from './phases'
import { truncVisible } from '../tui/layout'

const RESET = '\x1b[0m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const CYAN = '\x1b[36m'
const YELLOW = '\x1b[33m'

export interface HelpOptions {
  color: boolean
  width: number
  esperando: number
  primeiroComando: string
  repo: string
}

const PADRAO: HelpOptions = { color: false, width: 78, esperando: 0, primeiroComando: '', repo: '' }

interface Item {
  chave: string
  arg: string
  texto: string
}

interface Secao {
  titulo: string
  itens: Item[]
}

const SECOES: Secao[] = [
  {
    titulo: 'comecar',
    itens: [
      { chave: 'escreva', arg: 'a tarefa', texto: 'vira tarefa e ja entra na fila, na ia escolhida' },
      { chave: '/new-task', arg: '<mudanca>', texto: 'igual escrever direto — cria a tarefa e enfileira' },
      { chave: '/new-ask', arg: '<pergunta>', texto: 'pergunta sobre o projeto, sem criar card' },
      { chave: '/ref', arg: '<url|caminho|clipboard>', texto: 'anexa imagem de referencia para a IA copiar o design' },
      { chave: '/new-session', arg: '', texto: 'limpa a area e recomeca a sessao' },
      { chave: '/new', arg: '', texto: 'atalho de /new-session' },
      { chave: '20', arg: '', texto: 'so o numero abre o plano da tarefa (so leitura, ja esta na fila)' },
      { chave: 'enter', arg: '', texto: 'aprova o plano de uma tarefa que ainda esta esperando' },
    ],
  },
  {
    titulo: 'acompanhar',
    itens: [
      { chave: '/help', arg: '', texto: 'esta lista de comandos e teclas' },
      { chave: '/historico', arg: '', texto: 'historico de sessoes do motor — sai da tarefa aberta' },
      { chave: '/config', arg: '', texto: 'ias conectadas, uso da janela e gasto' },
    ],
  },
  {
    titulo: 'decidir',
    itens: [
      { chave: '1 2 3', arg: '', texto: 'dentro da tarefa: aprova, refaz, ou diz o que ajustar' },
      { chave: '/stop', arg: '<id> [motivo]', texto: 'para a tarefa em execucao' },
      { chave: '/rm', arg: '<id> [id...]', texto: 'apaga tarefas e limpa worktree e url' },
    ],
  },
  {
    titulo: 'projeto',
    itens: [
      { chave: '/ia', arg: '[papel] <ia>', texto: 'escolhe a ia que roda cada papel' },
      { chave: '/model', arg: '[papel] <modelo>', texto: 'escolhe o modelo da ia atual' },
      { chave: '/effort', arg: '[papel] <nivel>', texto: 'escolhe o esforco da ia atual' },
      { chave: '/mode', arg: '[papel] <modo>', texto: 'escolhe o modo de operacao da ia atual' },
      { chave: '/login', arg: '[ia]', texto: 'mostra como autenticar a ia que ainda nao logou' },
      { chave: '/repo', arg: '[owner/nome]', texto: 'troca de projeto, ou lista os registrados' },
      { chave: '/exit', arg: '', texto: 'sai do hii — as tarefas seguem rodando' },
    ],
  },
  {
    titulo: 'teclas',
    itens: [
      { chave: '↓ enter', arg: '', texto: 'seleciona a tarefa no rodape e entra nela' },
      { chave: 'ctrl+j', arg: '', texto: 'quebra linha sem enviar' },
      { chave: 'ctrl+bksp', arg: '', texto: 'apaga a palavra inteira' },
      { chave: 'tab', arg: '', texto: 'completa comandos' },
      { chave: 'shift+tab', arg: '', texto: 'campo vazio cicla o modo de operacao da ia atual' },
    ],
  },
]

function paint(s: string, cor: string, o: HelpOptions): string {
  return o.color ? `${cor}${s}${RESET}` : s
}

function rotuloDe(item: Item): string {
  return item.arg ? `${item.chave} ${item.arg}` : item.chave
}

function larguraDoRotulo(compacto: boolean): number {
  return SECOES.flatMap(s => s.itens)
    .reduce((a, i) => Math.max(a, compacto ? i.chave.length : rotuloDe(i).length), 0)
}

function linhaDoItem(item: Item, largura: number, compacto: boolean, o: HelpOptions): string {
  const visivel = compacto ? item.chave : rotuloDe(item)
  const pintado = item.arg && !compacto
    ? `${paint(item.chave, CYAN, o)} ${paint(item.arg, DIM, o)}`
    : paint(item.chave, CYAN, o)
  const recuo = ' '.repeat(Math.max(1, largura - visivel.length + 2))
  const sobra = Math.max(8, o.width - largura - 8)
  return `    ${pintado}${recuo}${paint(item.texto.slice(0, sobra), DIM, o)}`
}

export function renderHelp(opts: Partial<HelpOptions> = {}): string[] {
  const o = { ...PADRAO, ...opts }
  const compacto = o.width < 60
  const largura = larguraDoRotulo(compacto)
  const out: string[] = ['']
  out.push(`  ${paint('hii', BOLD, o)} ${paint(o.repo ? `· ${o.repo}` : '', DIM, o)}`.trimEnd())
  out.push(`  ${paint(PHASES.map(p => p.label).join(' › '), DIM, o)}`)
  if (o.esperando > 0) {
    const quantas = o.esperando === 1 ? '1 tarefa espera' : `${o.esperando} tarefas esperam`
    const dica = o.primeiroComando ? ` — comece por ${o.primeiroComando}` : ''
    out.push('')
    out.push(`  ${paint('●', YELLOW, o)} ${paint(`${quantas} por voce${dica}`, YELLOW, o)}`)
  }
  for (const secao of SECOES) {
    out.push('')
    out.push(`  ${paint(secao.titulo, BOLD, o)}`)
    for (const item of secao.itens) out.push(linhaDoItem(item, largura, compacto, o))
  }
  out.push('')
  return out.map(l => truncVisible(l, o.width))
}
