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
  '/gauntlet': 'crivo julga telas por comparacao cega em vez de ler o diff',
  '/login': 'mostra como autenticar a ia que ainda nao logou',
  '/repo': 'troca de projeto',
  '/exit': 'sai do hii — as tarefas seguem rodando',
  // Item 16 — atalhos de intake: carregam o conhecimento do dominio antes de o
  // disco ter arquivo que dispare o gatilho.
  '/orquestrador-jogos': 'tarefa de jogo — engine, netcode, replay, build',
  '/orquestrador-dev-web': 'tarefa web — front e back ja com o dominio carregado',
  '/orquestrador-android': 'tarefa mobile — Android, iOS e publicacao em loja',
  '/orquestrador-devops': 'tarefa de infra — pipeline, imagem, deploy, SLO',
  '/layout': 'tarefa visual — entrada padrao da fase de plano',
  '/hii-design': 'design/visual — sem passo de polimento, so o crivo do fecho',
  '/hii-dev-web': 'web front+back — roda Arquitetura e Testes',
  '/hii-backend': 'backend — roda Testes e Seguranca',
  // Pipeline manual (padrao apos aprovar a url): um comando por passo, e a
  // suite que roda o restante e fecha. Quem executa e o runner — o comando so
  // grava o pedido no card (cartorio/passos-manuais.ts).
  '/arquitetura': 'roda so o passo de arquitetura do card e pausa de novo',
  '/polimento': 'apelido de /arquitetura — primeiro passo do pipeline',
  '/testes': 'roda so o passo de testes do card e pausa de novo',
  '/seguranca': 'roda so o passo de seguranca do card e pausa de novo',
  '/limpeza': 'roda so o passo de limpeza do card e pausa de novo',
  '/hii': 'roda o pipeline restante de uma vez e segue para build, gates e PR',
}

export interface GrupoDeSugestao {
  titulo: string
  cor: Rgb
}

export const SUGESTOES_VISIVEIS = 6

// Duas linhas ficam para as setas de "N acima"/"N abaixo".
const LINHAS_DAS_SETAS = 2

// Quantas linhas de OPCAO cabem, dadas as linhas do terminal. Conservador de
// proposito: e melhor mostrar 3 navegaveis que 6 cortadas pelo quadro.
export function cabemQuantasSugestoes(rows: number): number {
  const disponivel = (Number.isFinite(rows) ? rows : 24) - 12 - LINHAS_DAS_SETAS
  return Math.max(1, Math.min(SUGESTOES_VISIVEIS, disponivel))
}

// Janela em volta da SELECAO, e nao os N primeiros. Com `slice(0, 6)` fixo, apertar
// ↓ movia a selecao para a setima opcao e a tela continuava mostrando as seis
// primeiras: o "e mais N" era um beco sem saida. A mesma forma que
// `janelaDaLista` ja usava para as listas do rodape.
export interface SugestoesOptions {
  color: boolean
  width: number
  selecionado: number
  grupoDe?: (opcao: string) => GrupoDeSugestao | null
  descricaoDe?: (opcao: string) => string | undefined
  profundidade?: Profundidade
  // Teto de linhas de OPCAO (sem contar as setas). Ver cabemQuantasSugestoes.
  maxLinhas: number
}

const PADRAO: SugestoesOptions = { color: false, width: 78, selecionado: -1, maxLinhas: SUGESTOES_VISIVEIS }

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

export function janelaDeSugestoes(total: number, selecionado: number, max: number): { inicio: number; fim: number } {
  if (total <= max) return { inicio: 0, fim: total }
  const i = selecionado < 0 ? 0 : Math.min(selecionado, total - 1)
  const inicio = Math.max(0, Math.min(i - Math.floor((max - 1) / 2), total - max))
  return { inicio, fim: inicio + max }
}

export function renderSugestoes(opcoes: string[], opts: Partial<SugestoesOptions> = {}): string[] {
  const o = { ...PADRAO, ...opts }
  if (!opcoes.length) return []
  // `maxLinhas` e o teto de linhas de OPCAO que cabem na tela. Sem ele a janela era
  // sempre de 6 e o quadro (renderFrame) cortava as PRIMEIRAS N por falta de altura
  // — re-quebrando a navegacao num terminal baixo, exatamente onde ela mais falta.
  const janela = janelaDeSugestoes(opcoes.length, o.selecionado, Math.max(1, o.maxLinhas))
  const mostrar = opcoes.slice(janela.inicio, janela.fim)
  const largura = mostrar.reduce((a, s) => Math.max(a, s.length), 0)
  // `selecionado` e indice na lista INTEIRA; dentro da janela ele desloca.
  const selecionadoNaJanela = o.selecionado - janela.inicio
  const linhas = o.grupoDe && temGrupoDeIa(mostrar, o.grupoDe)
    ? renderAgrupado(mostrar, largura, { ...o, selecionado: selecionadoNaJanela }, o.grupoDe)
    : mostrar.map((opcao, i) => linhaDaOpcao(opcao, largura, i === selecionadoNaJanela, CYAN, o))
  // Conta os dois lados: esconder que ha opcao ACIMA e o que fazia a lista parecer
  // o comeco quando ja estava no meio.
  const acima = janela.inicio
  const abaixo = opcoes.length - janela.fim
  if (acima > 0) linhas.unshift(paint(`  ↑ ${acima} acima`, DIM, o))
  if (abaixo > 0) linhas.push(paint(`  ↓ ${abaixo} abaixo`, DIM, o))
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
