import { truncVisible, padVisible } from '../tui/layout.ts'
import { profundidadeDeCor, sequenciaDe } from '../tui/paleta.ts'
import type { Profundidade, Rgb } from '../tui/paleta.ts'

const RESET = '\x1b[0m'
const DIM = '\x1b[2m'
const CYAN = '\x1b[36m'
const INVERSO = '\x1b[7m'
const TITULO_HII = 'hii'

export const AJUDA_DO_COMANDO: Record<string, string> = {
  '/help': 'todos os comandos e teclas',
  '/historico': 'historico de sessoes do motor — sai da tarefa aberta',
  '/config': 'ias conectadas, uso de 5h e da semana, tokens e loop',
  '/stop': 'para a tarefa em execucao',
  '/rm': 'apaga tarefas e limpa o que fica atras',
  '/new-task': 'cria a tarefa direto, sem leitura de intencao',
  '/new-ask': 'pergunta sobre o projeto, sem criar card',
  '/new-session': 'limpa a area e recomeca a sessao',
  '/ref': 'anexa imagem de referencia (url, caminho ou clipboard)',
  '/ia': 'escolhe a ia que roda cada papel',
  '/model': 'escolhe o modelo da ia atual',
  '/effort': 'escolhe o esforco da ia atual',
  '/mode': 'escolhe o modo de operacao da ia atual',
  '/login': 'mostra como autenticar a ia que ainda nao logou',
  '/repo': 'troca de projeto',
  '/exit': 'sai do hii — as tarefas seguem rodando',
}

export interface GrupoDeSugestao {
  titulo: string
  cor: Rgb
}

export interface SugestoesOptions {
  color: boolean
  width: number
  selecionado: number
  grupoDe?: (opcao: string) => GrupoDeSugestao | null
  descricaoDe?: (opcao: string) => string | undefined
  profundidade?: Profundidade
}

const PADRAO: SugestoesOptions = { color: false, width: 78, selecionado: -1 }

function paint(s: string, cor: string, o: SugestoesOptions): string {
  return o.color ? `${cor}${s}${RESET}` : s
}

function corDoGrupo(g: GrupoDeSugestao | null, o: SugestoesOptions): string {
  if (!o.color || !g) return CYAN
  return sequenciaDe(g.cor, o.profundidade ?? profundidadeDeCor()) || CYAN
}

function temGrupoDeIa(opcoes: string[], grupoDe: (opcao: string) => GrupoDeSugestao | null): boolean {
  return opcoes.some(o => grupoDe(o) !== null)
}

function ajudaDe(opcao: string, o: SugestoesOptions): string {
  return o.descricaoDe?.(opcao) ?? AJUDA_DO_COMANDO[opcao] ?? ''
}

function linhaDaOpcao(opcao: string, largura: number, alvo: boolean, cor: string, o: SugestoesOptions): string {
  const rotulo = padVisible(opcao, largura)
  const corpo = alvo ? paint(` ${rotulo} `, INVERSO, o) : ` ${paint(rotulo, cor, o)} `
  const cauda = ajudaDe(opcao, o) ? paint(`  ${ajudaDe(opcao, o)}`, DIM, o) : ''
  return truncVisible(`  ${corpo}${cauda}`, o.width)
}

function renderAgrupado(mostrar: string[], largura: number, o: SugestoesOptions, grupoDe: (opcao: string) => GrupoDeSugestao | null): string[] {
  const linhas: string[] = []
  let grupoAtual = ''
  mostrar.forEach((opcao, i) => {
    const grupo = grupoDe(opcao)
    const titulo = grupo?.titulo ?? TITULO_HII
    if (titulo !== grupoAtual) {
      grupoAtual = titulo
      linhas.push(truncVisible(`  ${paint(titulo, DIM, o)}`, o.width))
    }
    linhas.push(linhaDaOpcao(opcao, largura, i === o.selecionado, corDoGrupo(grupo, o), o))
  })
  return linhas
}

export function renderSugestoes(opcoes: string[], opts: Partial<SugestoesOptions> = {}): string[] {
  const o = { ...PADRAO, ...opts }
  if (!opcoes.length) return []
  const mostrar = opcoes.slice(0, 6)
  const largura = mostrar.reduce((a, s) => Math.max(a, s.length), 0)
  const linhas = o.grupoDe && temGrupoDeIa(mostrar, o.grupoDe)
    ? renderAgrupado(mostrar, largura, o, o.grupoDe)
    : mostrar.map((opcao, i) => linhaDaOpcao(opcao, largura, i === o.selecionado, CYAN, o))
  const resto = opcoes.length - mostrar.length
  if (resto > 0) linhas.push(paint(`  e mais ${resto}`, DIM, o))
  return linhas
}

export function prefixoComum(opcoes: string[]): string {
  if (!opcoes.length) return ''
  const primeiro = opcoes[0] ?? ''
  let fim = primeiro.length
  for (const o of opcoes) {
    let i = 0
    while (i < fim && i < o.length && o[i] === primeiro[i]) i++
    fim = i
  }
  return primeiro.slice(0, fim)
}
