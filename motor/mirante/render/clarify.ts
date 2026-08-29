import type { Pendencia } from '../responder.ts'

export interface OpcoesClarify {
  color?: boolean
}

const RESET = '\x1b[0m'
const DIM = '\x1b[2m'
const ACC = '\x1b[36m'
const BOLD = '\x1b[1m'
// A PERGUNTA nao pode ser o texto mais apagado da tela. Ela era pintada com DIM no
// rodape — o mesmo cinza das dicas de tecla — entao a coisa que exige decisao ficava
// menos visivel que a legenda. Amarelo e o mesmo tom que `renderPendencia` ja usa
// para "precisa de voce": a tela inteira aponta para o mesmo lugar.
const PERGUNTA = '\x1b[1;33m'

function paint(s: string, cor: string, o: OpcoesClarify): string {
  return o.color ? `${cor}${s}${RESET}` : s
}

export function renderPergunta(p: Pendencia, o: OpcoesClarify = {}): string[] {
  const total = p.perguntas.length
  const passo = total > 1 ? ` (${p.indice + 1}/${total})` : ''
  const out: string[] = ['', `  ${paint(`#${p.id} precisa de uma decisao${passo}`, BOLD, o)}`, '']
  // A pergunta em destaque tambem aqui: e a unica coisa da tela que pede acao.
  for (const linha of quebrar(p.atual.q.replace(/\s+/g, ' ').trim(), 92)) out.push(`  ${paint(linha, PERGUNTA, o)}`)
  out.push('')
  p.atual.options.forEach((opcao, i) => {
    const sugerido = opcao === p.atual.recommended ? paint('  ← sugerido', DIM, o) : ''
    out.push(`    ${paint(String(i + 1), ACC, o)}  ${opcao}${sugerido}`)
  })
  out.push('')
  out.push(`  ${paint('digite o numero, ou escreva a resposta · enter aceita o sugerido', DIM, o)}`)
  return out
}

export function renderRespondidas(id: string, perguntas: { q: string; answer?: string }[], o: OpcoesClarify = {}): string[] {
  const respondidas = perguntas.filter(p => p.answer)
  if (!respondidas.length) return [`  #${id} nao tem pergunta nem resposta`]
  const out: string[] = ['', `  ${paint(`#${id} — decisoes que voce tomou`, BOLD, o)}`, '']
  for (const p of respondidas) {
    for (const linha of quebrar(p.q, 66)) out.push(`  ${paint(linha, DIM, o)}`)
    out.push(`    ${paint('→', ACC, o)} ${p.answer}`)
    out.push('')
  }
  return out
}

export interface OpcoesRodape {
  color?: boolean
  width?: number
  selecionado: string
}

// Quantas linhas a PERGUNTA pode ocupar no rodape. Cortar em uma linha escondia o
// essencial: as perguntas do crivo chegam a 240 caracteres, e o que sobrava era o
// comeco de uma frase sem o que ela pergunta de fato. Quebrar em varias linhas mostra
// a pergunta inteira nos casos reais, e o teto evita que uma pergunta enorme empurre
// as opcoes para fora da tela — que seria trocar um problema pelo outro.
const LINHAS_DA_PERGUNTA = 4

export function renderOpcoesRodape(p: Pendencia, o: OpcoesRodape): string[] {
  const largura = o.width ?? 78
  const cor = { color: o.color }
  const total = p.perguntas.length
  const passo = total > 1 ? ` (${p.indice + 1}/${total})` : ''
  const cabecalho = `  ${paint('?', ACC, cor)} ${paint(`#${p.id} pergunta${passo}`, BOLD, cor)}`
  const util = Math.max(20, largura - 6)
  const quebradas = quebrar(p.atual.q.replace(/\s+/g, ' ').trim(), util)
  const corpo = quebradas.slice(0, LINHAS_DA_PERGUNTA).map((linha, i) => {
    const ultima = i === LINHAS_DA_PERGUNTA - 1 && quebradas.length > LINHAS_DA_PERGUNTA
    return `    ${paint(ultima ? `${linha} …` : linha, PERGUNTA, cor)}`
  })
  const linhas = p.atual.options.map((opcao, i) => {
    const alvo = o.selecionado === `op:${i + 1}`
    const marca = alvo ? paint('›', ACC, cor) : ' '
    const numero = paint(String(i + 1), ACC, cor)
    const sugerido = opcao === p.atual.recommended ? paint('  sugerido', DIM, cor) : ''
    return `${marca} ${numero}  ${recorte(opcao, largura - 18)}${sugerido}`
  })
  return [cabecalho, ...corpo, ...linhas]
}

function recorte(texto: string, largura: number): string {
  const limpo = texto.replace(/\s+/g, ' ').trim()
  return limpo.length > largura ? `${limpo.slice(0, Math.max(4, largura - 1))}…` : limpo
}

export function quebrar(texto: string, largura: number): string[] {
  // Palavra MAIOR que a largura e partida na forca. Sem isto, um caminho longo, uma
  // URL ou um identificador sem espaco estouraria a linha e o quadro inteiro sairia
  // torto — quebrar por espaco so resolve texto que tem espaco.
  const palavras = texto.split(/\s+/).filter(Boolean).flatMap(p => {
    if (p.length <= largura) return [p]
    const pedacos: string[] = []
    for (let i = 0; i < p.length; i += largura) pedacos.push(p.slice(i, i + largura))
    return pedacos
  })
  const linhas: string[] = []
  let atual = ''
  for (const p of palavras) {
    if (atual && (atual + ' ' + p).length > largura) {
      linhas.push(atual)
      atual = p
    } else {
      atual = atual ? `${atual} ${p}` : p
    }
  }
  if (atual) linhas.push(atual)
  return linhas.length ? linhas : ['']
}
