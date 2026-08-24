import { truncVisible } from '../tui/layout.ts'

const RESET = '\x1b[0m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const CYAN = '\x1b[36m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'

export interface OpcaoAprovacao {
  chave: string
  texto: string
  cor: 'sim' | 'nao' | 'neutro'
}

export const OPCOES_APROVACAO: OpcaoAprovacao[] = [
  { chave: '1', texto: 'aprovar — segue para o polimento', cor: 'sim' },
  { chave: '2', texto: 'recusar e refazer do zero', cor: 'nao' },
  { chave: '3', texto: 'recusar dizendo o que ajustar', cor: 'nao' },
]

export const OPCOES_DA_URL: OpcaoAprovacao[] = [
  { chave: '1', texto: 'abriu e esta certo — segue para o polimento', cor: 'sim' },
  { chave: '2', texto: 'nao serve — refazer do zero', cor: 'nao' },
  { chave: '3', texto: 'nao abriu / falta algo — dizer o que ajustar', cor: 'nao' },
]

export type Verificacao = 'ok' | 'falhou' | 'inconclusivo' | ''

const PERGUNTA_POR_VERIFICACAO: Record<Verificacao, string> = {
  ok: 'e isso que voce queria?',
  falhou: 'a url subiu com erro — o que fazer?',
  inconclusivo: 'conseguiu abrir a url?',
  '': 'conseguiu abrir a url?',
}

const VEREDITO_DA_MAQUINA: Record<Verificacao, string> = {
  ok: '✓ o motor abriu a url e a pagina respondeu',
  falhou: '✗ o motor abriu a url e a pagina deu erro',
  inconclusivo: '? o motor nao conseguiu checar sozinho',
  '': '',
}

export interface AprovacaoOptions {
  color: boolean
  width: number
  selecionado: string
  url: string
  verificacao: Verificacao
  comentando: boolean
}

const PADRAO: AprovacaoOptions = { color: false, width: 78, selecionado: '', url: '', verificacao: '', comentando: false }

function paint(s: string, cor: string, o: AprovacaoOptions): string {
  return o.color ? `${cor}${s}${RESET}` : s
}

function corDa(op: OpcaoAprovacao): string {
  return op.cor === 'sim' ? GREEN : op.cor === 'nao' ? RED : CYAN
}

export function renderAprovacao(id: string, opts: Partial<AprovacaoOptions> = {}): string[] {
  const o = { ...PADRAO, ...opts }
  if (o.comentando) {
    return [
      `  ${paint('✎', CYAN, o)} ${paint(`#${id} — escreva o que ajustar`, BOLD, o)}${paint('  ·  enter vazio desiste', DIM, o)}`,
    ].map(l => truncVisible(l, o.width))
  }
  const pergunta = o.url ? PERGUNTA_POR_VERIFICACAO[o.verificacao] : 'a funcionalidade esta certa?'
  const semUrl = o.url ? '' : paint('  ·  sem url — confira pelo que a tarefa mudou', DIM, o)
  const cabecalho = `  ${paint('◎', CYAN, o)} ${paint(`#${id} ${pergunta}`, BOLD, o)}${semUrl}`
  const veredito = VEREDITO_DA_MAQUINA[o.verificacao]
  const alvo = o.url
    ? [`    ${paint(o.url, CYAN, o)}${veredito ? paint(`   ${veredito}`, o.verificacao === 'falhou' ? RED : DIM, o) : ''}`]
    : []
  const linhas = (o.url ? OPCOES_DA_URL : OPCOES_APROVACAO).map((op) => {
    const marcada = o.selecionado === `op:${op.chave}`
    const marca = marcada ? paint('›', CYAN, o) : ' '
    const numero = paint(op.chave, corDa(op), o)
    const texto = marcada && o.color ? `${BOLD}${op.texto}${RESET}` : paint(op.texto, DIM, o)
    return `${marca} ${numero}  ${texto}`
  })
  return [cabecalho, ...alvo, ...linhas].map(l => truncVisible(l, o.width))
}

export function verificacaoDoCard(bruto: string): Verificacao {
  if (bruto === 'ok' || bruto === 'falhou' || bruto === 'inconclusivo') return bruto
  return ''
}
