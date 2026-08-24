import { CANTO } from './paleta.ts'
import { grafemasDe, larguraDeGrafema, larguraDeTexto } from './largura.ts'

export { stripAnsi } from './largura.ts'

const RESET = '\x1b[0m'
const ELIPSE = '…'
const OSC_SPLIT = /(\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)[^\x1b]*\x1b\][^\x07\x1b]*(?:\x07|\x1b\\))/
const ESCAPE_SPLIT = /(\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\))/

const RE_URL = /https?:\/\/[^\s<>"')\]\x1b]+/g

export function suportaLink(env: Record<string, string | undefined> = process.env): boolean {
  const forcado = env.HICODE_HYPERLINKS
  if (forcado === 'on') return true
  if (forcado === 'off') return false
  if (env.WT_SESSION) return true
  if (env.KITTY_WINDOW_ID || env.GHOSTTY_RESOURCES_DIR) return true
  if (env.VTE_VERSION && Number(env.VTE_VERSION) >= 5000) return true
  const prog = env.TERM_PROGRAM ?? ''
  return ['iTerm.app', 'WezTerm', 'vscode', 'Hyper', 'Rio'].includes(prog)
}

export function link(url: string, texto = url): string {
  if (!suportaLink()) return texto
  return `\x1b]8;;${url}\x1b\\${texto}\x1b]8;;\x1b\\`
}

export function linkificar(texto: string): string {
  if (!suportaLink()) return texto
  const partes = texto.split(OSC_SPLIT)
  return partes
    .map((p, i) => (i % 2 === 1 ? p : p.replace(RE_URL, u => link(u))))
    .join('')
}

export function visibleLen(s: string): number {
  return larguraDeTexto(s)
}

export function truncVisible(s: string, max: number): string {
  if (max <= 0) return ''
  if (visibleLen(s) <= max) return s
  const teto = max - larguraDeGrafema(ELIPSE)
  const partes = s.split(ESCAPE_SPLIT)
  let colunas = 0
  let out = ''
  let temAnsi = false
  for (let i = 0; i < partes.length; i++) {
    const parte = partes[i] ?? ''
    if (i % 2 === 1) {
      out += parte
      temAnsi = true
      continue
    }
    for (const grafema of grafemasDe(parte)) {
      const largura = larguraDeGrafema(grafema)
      if (colunas + largura > teto) return out + ELIPSE + (temAnsi ? RESET : '')
      out += grafema
      colunas += largura
    }
  }
  return out + ELIPSE + (temAnsi ? RESET : '')
}

export function padVisible(s: string, largura: number): string {
  const cortado = truncVisible(s, largura)
  const falta = largura - visibleLen(cortado)
  return falta > 0 ? cortado + ' '.repeat(falta) : cortado
}

export interface FrameInput {
  rows: number
  cols: number
  header: string
  corpo: string[]
  fixo?: string[]
  input: string
  corInput?: (linha: string) => string
  sugestoes?: string[]
  legenda?: string
  cursor: number
  dica: string
  prompt: string
  rodape: string[]
}

export interface Frame {
  lines: string[]
  cursorRow: number
  cursorCol: number
}

const MIN_CORPO = 3
const MIN_ROLANTE = 5
const FATIA_PINADA = 0.4
const ALTURA_MINIMA = 4

export interface OrcamentoDoCorpo {
  rows: number
  temLegenda: boolean
  temDica: boolean
  linhasDeEntrada: number
  linhasDeRodape: number
  linhasAcima: number
}

export interface CorpoRecortado {
  sugVisiveis: number
  rodapeVisivel: number
  alturaCorpo: number
}

export function orcamentoDoCorpo(o: OrcamentoDoCorpo): CorpoRecortado {
  const moldura = o.temLegenda && o.rows >= ALTURA_MINIMA + 2 ? 2 : 0
  const linhaDica = o.temDica && o.rows >= ALTURA_MINIMA + moldura + 1 ? 1 : 0
  const fixo = 3 + Math.max(1, o.linhasDeEntrada) + moldura + linhaDica
  const disponivel = Math.max(0, o.rows - fixo)
  const sugVisiveis = Math.min(o.linhasAcima, Math.max(0, disponivel - 1))
  const rodapeVisivel = Math.min(o.linhasDeRodape, Math.max(0, disponivel - sugVisiveis - MIN_CORPO))
  return { sugVisiveis, rodapeVisivel, alturaCorpo: Math.max(0, disponivel - sugVisiveis - rodapeVisivel) }
}

export function posicaoNoTexto(texto: string, cursor: number): { linha: number; coluna: number } {
  const antes = texto.slice(0, Math.max(0, Math.min(cursor, texto.length)))
  const partes = antes.split('\n')
  return { linha: partes.length - 1, coluna: (partes[partes.length - 1] ?? '').length }
}

function colunaVisualDoCursor(linha: string, codeUnitsAntes: number): number {
  return visibleLen(linha.slice(0, codeUnitsAntes))
}

// Rolagem HORIZONTAL da linha de entrada.
//
// Antes a linha era simplesmente truncada no fim. Uma linha maior que o terminal
// escondia justamente o texto que estava sendo digitado, e `cursorCol` continuava
// crescendo — o cursor ia para fora da tela e o terminal o prendia na ultima
// coluna, longe do caractere real. Digitar um caminho longo, ou colar uma linha,
// bastava para acontecer.
//
// O corte e por GRAFEMA, e a janela anda em passos: reposicionar a cada tecla
// faria o texto tremer.
const PASSO_DE_ROLAGEM = 8

export interface JanelaHorizontal {
  readonly texto: string
  readonly colunaDoCursor: number
  // Deslocamento em COLUNAS que esta janela usou. As outras linhas de entrada
  // recebem este valor para andarem juntas.
  readonly deslocamento: number
}

function indiceDaColuna(colunaEm: readonly number[], coluna: number): number {
  let i = 0
  while (i + 1 < colunaEm.length && (colunaEm[i] ?? 0) < coluna) i++
  return i
}

// `coluna` e a coluna do CURSOR. `desloque` (quando dado) e o deslocamento em
// COLUNAS que a janela deve usar — as linhas SEM cursor precisam do mesmo
// deslocamento da linha do cursor, senao cada uma rola por conta propria e o
// bloco multilinha fica desalinhado. Passar o deslocamento no lugar de `coluna`
// (o que a primeira versao fazia) dava a janela MINIMA que contem aquela coluna,
// ou seja um deslocamento diferente por linha.
export function janelaHorizontal(linha: string, coluna: number, largura: number, desloque?: number): JanelaHorizontal {
  const alvo = Math.max(1, largura)
  // `< alvo`, nao `<= alvo`: com o cursor na coluna `alvo` a posicao visual cai
  // uma coluna DEPOIS do fim da janela, e no caminho sem moldura isso punha
  // cursorCol em cols+1 — fora da tela.
  if (desloque === undefined && visibleLen(linha) <= alvo && coluna < alvo) return { texto: linha, colunaDoCursor: coluna, deslocamento: 0 }
  const grafemas = grafemasDe(linha)
  const larguras = grafemas.map(larguraDeGrafema)
  // Coluna acumulada ANTES de cada grafema, mais a coluna final.
  const colunaEm: number[] = [0]
  for (const w of larguras) colunaEm.push((colunaEm[colunaEm.length - 1] ?? 0) + w)
  const cursorColuna = Math.max(0, Math.min(coluna, colunaEm[colunaEm.length - 1] ?? 0))
  // Menor deslocamento que ainda deixa o cursor dentro da janela. Calculado por
  // busca no acumulado, nao por passos as cegas: o passo cego podia pular o fim da
  // linha inteira e devolver janela VAZIA, com o cursor "visivel" sobre nada.
  let minimo = 0
  while (minimo < grafemas.length && cursorColuna - (colunaEm[minimo] ?? 0) > alvo - 1) minimo++
  // Com o cursor no FIM da linha nao ha grafema sob ele, e o calculo acima pode
  // apontar para depois do ultimo — janela vazia com o cursor "visivel" sobre
  // nada. Nesse caso mostra os ultimos grafemas e o cursor encosta na borda.
  const ultimo = Math.max(0, grafemas.length - 1)
  if (minimo > ultimo) minimo = ultimo
  // Indice do grafema sobre o qual o cursor esta. O deslocamento nunca pode passar
  // dele: passar significa rolar para depois do cursor e mostrar janela vazia.
  let indiceDoCursor = 0
  while (indiceDoCursor < ultimo && (colunaEm[indiceDoCursor + 1] ?? 0) <= cursorColuna) indiceDoCursor++
  // Em passos, para o texto nao tremer a cada tecla — mas so quando o passo cabe
  // sem ultrapassar o cursor. Senao vale o minimo exato.
  // O passo serve para o texto nao tremer a cada tecla, mas nao pode ESCONDER
  // texto que caberia: com a linha exatamente do tamanho da janela e o cursor no
  // fim, `minimo` e 1 e o passo saltava 8 colunas, deixando branco a direita.
  const emPassos = Math.ceil(minimo / PASSO_DE_ROLAGEM) * PASSO_DE_ROLAGEM
  const cabeNoPasso = (colunaEm[colunaEm.length - 1] ?? 0) - (colunaEm[emPassos] ?? 0) >= alvo
  const escolhido = emPassos <= indiceDoCursor && cabeNoPasso ? emPassos : minimo
  // Deslocamento imposto de fora: converte COLUNA em indice de grafema, para
  // todas as linhas de entrada partirem do mesmo ponto visual.
  const inicio = desloque === undefined ? escolhido : indiceDaColuna(colunaEm, desloque)
  let texto = ''
  let colunas = 0
  for (let i = inicio; i < grafemas.length; i++) {
    const w = larguras[i] ?? 0
    if (colunas + w > alvo) break
    texto += grafemas[i] ?? ''
    colunas += w
  }
  return {
    texto,
    colunaDoCursor: Math.max(0, Math.min(alvo, cursorColuna - (colunaEm[inicio] ?? 0))),
    deslocamento: colunaEm[inicio] ?? 0,
  }
}

export function renderFrame(f: FrameInput): Frame {
  const largura = Math.max(24, f.cols)
  const interno = largura - 4
  const rodape = f.rodape ?? []
  const sugestoes = f.sugestoes ?? []
  const moldura = f.legenda !== undefined && f.rows >= ALTURA_MINIMA + 2 ? 2 : 0
  const linhaDica = f.dica && f.rows >= ALTURA_MINIMA + moldura + 1 ? 1 : 0
  const pos = posicaoNoTexto(f.input, f.cursor)
  const todasEntradas = f.input.split('\n')
  const maxEntrada = Math.max(1, f.rows - 3 - moldura - linhaDica - MIN_CORPO)
  const inicioEntrada = todasEntradas.length <= maxEntrada
    ? 0
    : Math.max(0, Math.min(pos.linha - maxEntrada + 1, todasEntradas.length - maxEntrada))
  const entrada = todasEntradas.slice(inicioEntrada, inicioEntrada + maxEntrada)
  const alturaEntrada = entrada.length
  const orcamento = orcamentoDoCorpo({
    rows: f.rows,
    temLegenda: f.legenda !== undefined,
    temDica: !!f.dica,
    linhasDeEntrada: alturaEntrada,
    linhasDeRodape: rodape.length,
    linhasAcima: sugestoes.length,
  })
  const sugVisiveis = sugestoes.slice(0, orcamento.sugVisiveis)
  const rodapeVisivel = rodape.slice(0, orcamento.rodapeVisivel)
  const alturaCorpo = orcamento.alturaCorpo
  const pinado = f.fixo ?? []
  const tetoPinado = Math.max(1, Math.min(alturaCorpo - MIN_ROLANTE, Math.floor(alturaCorpo * FATIA_PINADA)))
  const quantosPinados = alturaCorpo ? Math.min(pinado.length, tetoPinado) : 0
  const pinadoVisivel = pinado.slice(0, quantosPinados)
  const alturaRolante = Math.max(0, alturaCorpo - quantosPinados)
  const rolantes = alturaRolante ? f.corpo.slice(-alturaRolante) : []
  const visiveis = [...pinadoVisivel, ...rolantes]
  const lines: string[] = []
  lines.push(padVisible('  ' + truncVisible(f.header, largura - 2), largura))
  lines.push('  ' + CANTO.supEsq + '─'.repeat(interno) + CANTO.supDir)
  for (let i = 0; i < alturaCorpo; i++) {
    const conteudo = visiveis[i] ?? ''
    lines.push('  │' + padVisible(truncVisible(conteudo, interno), interno) + '│')
  }
  lines.push('  ' + CANTO.infEsq + '─'.repeat(interno) + CANTO.infDir)
  for (const sg of sugVisiveis) lines.push(padVisible('  ' + truncVisible(sg, largura - 2), largura))
  const comMoldura = moldura === 2
  if (comMoldura) {
    const rotulo = f.legenda ? ` ${truncVisible(f.legenda, Math.max(4, interno - 4))} ` : ''
    const sobra = Math.max(0, interno - 1 - visibleLen(rotulo))
    lines.push('  ' + CANTO.supEsq + '─' + rotulo + '─'.repeat(sobra) + CANTO.supDir)
  }
  const recuo = ' '.repeat(visibleLen(f.prompt))
  const primeira = lines.length + 1
  // Largura util para o TEXTO da entrada, ja descontado o prompt e a moldura.
  const larguraDoTextoDeEntrada = Math.max(1, (comMoldura ? interno - 2 : largura - 2) - visibleLen(f.prompt))
  const linhaDoCursor = todasEntradas[pos.linha] ?? ''
  const janelaDoCursor = janelaHorizontal(linhaDoCursor, colunaVisualDoCursor(linhaDoCursor, pos.coluna), larguraDoTextoDeEntrada)
  // Todas as linhas de entrada andam com o MESMO deslocamento — o da linha do
  // cursor. A primeira versao passava o deslocamento no parametro `coluna`, o que
  // dava a cada linha a janela minima que contem aquela coluna: deslocamentos
  // diferentes por linha, e o comentario afirmando o contrario.
  const deslocamento = janelaDoCursor.deslocamento
  entrada.forEach((linha, i) => {
    const prefixo = i === 0 ? f.prompt : recuo
    const visivel = deslocamento > 0
      ? janelaHorizontal(linha, 0, larguraDoTextoDeEntrada, deslocamento).texto
      : truncVisible(linha, larguraDoTextoDeEntrada)
    const pintada = f.corInput ? f.corInput(visivel) : visivel
    const conteudo = prefixo + pintada
    lines.push(comMoldura
      ? '  │ ' + padVisible(truncVisible(conteudo, interno - 2), interno - 2) + ' │'
      : padVisible('  ' + conteudo, largura))
  })
  if (comMoldura) lines.push('  ' + CANTO.infEsq + '─'.repeat(interno) + CANTO.infDir)
  if (linhaDica) lines.push(padVisible('    ' + truncVisible(f.dica ?? '', largura - 4), largura))
  for (const r of rodapeVisivel) lines.push(padVisible('  ' + truncVisible(r, largura - 2), largura))
  return {
    lines,
    cursorRow: primeira + (pos.linha - inicioEntrada),
    // A coluna vem da JANELA, nao do texto inteiro: senao ela cresce alem da
    // largura do terminal e o cursor visual para de acompanhar o caractere.
    cursorCol: (comMoldura ? 5 : 3) + visibleLen(f.prompt) + janelaDoCursor.colunaDoCursor,
  }
}

export function quebrarEmLargura(texto: string, largura: number): string[] {
  const alvo = Math.max(20, largura)
  const saida: string[] = []
  for (const bruta of texto.split('\n')) {
    const linha = bruta.replace(/\s+$/, '')
    if (visibleLen(linha) <= alvo) { saida.push(linha); continue }
    const recuo = (linha.match(/^\s*/) ?? [''])[0]
    let atual = recuo
    for (const palavra of linha.trim().split(/\s+/)) {
      const candidata = atual.trim() ? `${atual} ${palavra}` : `${recuo}${palavra}`
      if (visibleLen(candidata) > alvo && atual.trim()) {
        saida.push(atual)
        atual = `${recuo}${palavra}`
      } else {
        atual = candidata
      }
    }
    if (atual.trim()) saida.push(atual)
  }
  return saida
}
