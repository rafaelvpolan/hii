type Faixa = readonly [inicio: number, fim: number]

const CSI = /\x1b\[[0-9;?]*[A-Za-z]/g
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g
const SO_ASCII_IMPRIMIVEL = /^[\x20-\x7e]*$/

const SEM_LARGURA = 0
const SIMPLES = 1
const DUPLA = 2

const CONTROLES: readonly Faixa[] = [
  [0x0000, 0x001f], [0x007f, 0x009f],
]

const MARCAS_COMBINANTES: readonly Faixa[] = [
  [0x0300, 0x036f], [0x0483, 0x0489], [0x0591, 0x05bd], [0x05bf, 0x05bf],
  [0x05c1, 0x05c2], [0x05c4, 0x05c5], [0x05c7, 0x05c7], [0x0610, 0x061a],
  [0x064b, 0x065f], [0x0670, 0x0670], [0x06d6, 0x06dc], [0x06df, 0x06e4],
  [0x06e7, 0x06e8], [0x06ea, 0x06ed], [0x0711, 0x0711], [0x0730, 0x074a],
  [0x07a6, 0x07b0], [0x07eb, 0x07f3], [0x0816, 0x0819], [0x081b, 0x0823],
  [0x0825, 0x0827], [0x0829, 0x082d], [0x0859, 0x085b], [0x08d3, 0x08e1],
  [0x08e3, 0x0902], [0x093a, 0x093a], [0x093c, 0x093c], [0x0941, 0x0948],
  [0x094d, 0x094d], [0x0951, 0x0957], [0x0962, 0x0963], [0x0e31, 0x0e31],
  [0x0e34, 0x0e3a], [0x0e47, 0x0e4e], [0x0eb1, 0x0eb1], [0x0eb4, 0x0ebc],
  [0x0ec8, 0x0ecd], [0x0f71, 0x0f7e], [0x0f80, 0x0f84], [0x0f86, 0x0f87],
  [0x135d, 0x135f], [0x1ab0, 0x1aff], [0x1dc0, 0x1dff], [0x20d0, 0x20f0],
  [0x2cef, 0x2cf1], [0x2de0, 0x2dff], [0xa66f, 0xa672], [0xa674, 0xa67d],
  [0xfe20, 0xfe2f], [0x101fd, 0x101fd], [0x1d167, 0x1d169], [0x1d17b, 0x1d182],
  [0x1d185, 0x1d18b], [0x1d1aa, 0x1d1ad], [0x1e8d0, 0x1e8d6],
]

const JUNTORES_E_SELETORES: readonly Faixa[] = [
  [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x2064], [0x206a, 0x206f],
  [0xfe00, 0xfe0f], [0xfeff, 0xfeff], [0xfff9, 0xfffb],
  [0xe0000, 0xe007f], [0xe0100, 0xe01ef],
]

const IDEOGRAFICAS: readonly Faixa[] = [
  [0x1100, 0x115f], [0x2329, 0x232a], [0x2e80, 0x303e], [0x3041, 0x33ff],
  [0x3400, 0x4dbf], [0x4e00, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3],
  [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f], [0xff00, 0xff60],
  [0xffe0, 0xffe6], [0x16fe0, 0x16fe4], [0x17000, 0x187f7], [0x18800, 0x18cd5],
  [0x1b000, 0x1b2ff], [0x1f200, 0x1f251], [0x20000, 0x2fffd], [0x30000, 0x3fffd],
]

const EMOJI: readonly Faixa[] = [
  [0x231a, 0x231b], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3],
  [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f],
  [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab], [0x26bd, 0x26be],
  [0x26c4, 0x26c5], [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea],
  [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa], [0x26fd, 0x26fd],
  [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728], [0x274c, 0x274c],
  [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797],
  [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50],
  [0x2b55, 0x2b55], [0x1f004, 0x1f004], [0x1f0cf, 0x1f0cf], [0x1f18e, 0x1f18e],
  [0x1f191, 0x1f19a], [0x1f1e6, 0x1f1ff], [0x1f300, 0x1f320], [0x1f32d, 0x1f335],
  [0x1f337, 0x1f37c], [0x1f37e, 0x1f393], [0x1f3a0, 0x1f3ca], [0x1f3cf, 0x1f3d3],
  [0x1f3e0, 0x1f3f0], [0x1f3f4, 0x1f3f4], [0x1f3f8, 0x1f43e], [0x1f440, 0x1f440],
  [0x1f442, 0x1f4fc], [0x1f4ff, 0x1f53d], [0x1f54b, 0x1f54e], [0x1f550, 0x1f567],
  [0x1f57a, 0x1f57a], [0x1f595, 0x1f596], [0x1f5a4, 0x1f5a4], [0x1f5fb, 0x1f64f],
  [0x1f680, 0x1f6c5], [0x1f6cc, 0x1f6cc], [0x1f6d0, 0x1f6d2], [0x1f6d5, 0x1f6d7],
  [0x1f6dc, 0x1f6df], [0x1f6eb, 0x1f6ec], [0x1f6f4, 0x1f6fc], [0x1f7e0, 0x1f7eb],
  [0x1f7f0, 0x1f7f0], [0x1f90c, 0x1f93a], [0x1f93c, 0x1f945], [0x1f947, 0x1f9ff],
  [0x1fa70, 0x1fa7c], [0x1fa80, 0x1fa88], [0x1fa90, 0x1fabd], [0x1fabf, 0x1fac5],
  [0x1face, 0x1fadb], [0x1fae0, 0x1fae8], [0x1faf0, 0x1faf8],
]

function porInicio(faixas: readonly Faixa[]): readonly Faixa[] {
  return [...faixas].sort((a, b) => a[0] - b[0])
}

const FAIXAS_SEM_LARGURA = porInicio([...CONTROLES, ...MARCAS_COMBINANTES, ...JUNTORES_E_SELETORES])
const FAIXAS_DUPLAS = porInicio([...IDEOGRAFICAS, ...EMOJI])

const SEGMENTADOR = new Intl.Segmenter('pt-BR', { granularity: 'grapheme' })

export function stripAnsi(s: string): string {
  return s.replace(OSC, '').replace(CSI, '')
}

function contem(faixas: readonly Faixa[], codePoint: number): boolean {
  let baixo = 0
  let alto = faixas.length - 1
  while (baixo <= alto) {
    const meio = (baixo + alto) >> 1
    const faixa = faixas[meio]
    if (!faixa) return false
    if (codePoint < faixa[0]) alto = meio - 1
    else if (codePoint > faixa[1]) baixo = meio + 1
    else return true
  }
  return false
}

export function larguraDeCaractere(codePoint: number): number {
  if (!Number.isInteger(codePoint) || codePoint < 0) return SEM_LARGURA
  if (contem(FAIXAS_SEM_LARGURA, codePoint)) return SEM_LARGURA
  return contem(FAIXAS_DUPLAS, codePoint) ? DUPLA : SIMPLES
}

export function grafemasDe(texto: string): string[] {
  if (SO_ASCII_IMPRIMIVEL.test(texto)) return texto.split('')
  const saida: string[] = []
  for (const parte of SEGMENTADOR.segment(texto)) saida.push(parte.segment)
  return saida
}

export function larguraDeGrafema(grafema: string): number {
  let maior = SEM_LARGURA
  for (const caractere of grafema) {
    const largura = larguraDeCaractere(caractere.codePointAt(0) ?? -1)
    if (largura > maior) maior = largura
  }
  return maior
}

export function larguraDeTexto(s: string): number {
  const visivel = stripAnsi(s)
  if (SO_ASCII_IMPRIMIVEL.test(visivel)) return visivel.length
  let total = 0
  for (const grafema of grafemasDe(visivel)) total += larguraDeGrafema(grafema)
  return total
}

// ---------------------------------------------------------------------------
// Primitivas de UMA PASSADA, para quem precisa de no maximo `teto` colunas.
//
// O problema que elas resolvem: `truncVisible(s, 80)` custava proporcional a |s|,
// nao a 80. Medido antes de mexer, com `s` 500x maior: 140x o tempo em ASCII e
// 417x em texto Unicode (34ms por chamada numa linha de 100k, dentro do desenho da
// TUI). A causa nao era o laco — era materializar tudo antes de olhar: `visibleLen`
// percorria a string inteira so para decidir se ia cortar, `split` criava o array
// de partes, e `grafemasDe` criava o array de grafemas de cada parte.

// Generator: nao materializa. `grafemasDe` continua existindo para quem precisa da
// lista (a tabela de test/mir/largura.test.ts vale sobre ela).
export function* grafemasEm(texto: string): Generator<string> {
  if (SO_ASCII_IMPRIMIVEL.test(texto)) {
    for (const c of texto) yield c
    return
  }
  for (const parte of SEGMENTADOR.segment(texto)) yield parte.segment
}

// Regex STICKY: reconhece a sequencia ANSI na posicao corrente e devolve o tamanho
// dela, sem `split` e sem quebrar a string. `lastIndex` e reposicionado a cada
// tentativa, entao a regex e reutilizavel e nao guarda estado entre chamadas.
const ANSI_AQUI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/y

export function ansiNaPosicao(texto: string, i: number): string {
  if (texto.charCodeAt(i) !== 0x1b) return ''
  ANSI_AQUI.lastIndex = i
  return ANSI_AQUI.exec(texto)?.[0] ?? ''
}

export interface PedacoDoTexto {
  readonly texto: string
  readonly ansi: boolean
}

// Varre em pedacos alternados (visivel / sequencia ANSI) sem materializar a lista e
// sem pre-varrer. Duas armadilhas medidas antes de chegar nesta forma:
//
// 1. Um laco por code unit ate achar o proximo ESC devolvia a travessia completa
//    pela porta dos fundos (razao 15x em vez de ~1x).
// 2. `Intl.Segmenter.segment(s)` e preguicoso para ITERAR, mas tem custo de PREPARO
//    proporcional a |s|: consumir 90 grafemas de uma string de 100k custou 143us,
//    contra 11us na mesma string curta. Iterar preguicosamente nao basta — a string
//    entregue ao segmentador tem de ser pequena.
//
// Dai a JANELA. O ultimo grafema de cada janela e adiado para a janela seguinte,
// porque ele pode continuar depois do corte (marca combinante, ZWJ, surrogate): so
// se segmenta com o contexto inteiro a direita. Assim o resultado e identico ao de
// segmentar a string toda, e o custo e proporcional ao que foi consumido.
const JANELA = 512

export function* pedacosDe(texto: string): Generator<PedacoDoTexto> {
  let base = 0
  while (base < texto.length) {
    const fim = Math.min(texto.length, base + JANELA)
    const ultimaJanela = fim >= texto.length
    const janela = texto.slice(base, fim)
    let consumido = 0
    for (const parte of grafemasDaJanela(janela)) {
      // Adia o ULTIMO grafema quando ainda ha texto: ele pode continuar depois do
      // corte, e segmentado sozinho sairia diferente.
      if (!ultimaJanela && parte.indice + parte.grafema.length >= janela.length) break
      if (parte.indice < consumido) continue
      const emTexto = base + parte.indice
      if (texto.charCodeAt(emTexto) === 0x1b) {
        const seq = ansiNaPosicao(texto, emTexto)
        if (seq) {
          yield { texto: seq, ansi: true }
          consumido = parte.indice + seq.length
          continue
        }
      }
      yield { texto: parte.grafema, ansi: false }
      consumido = parte.indice + parte.grafema.length
    }
    if (consumido === 0) {
      // Janela inteira ocupada por um grafema so (ou por uma sequencia ANSI maior
      // que a janela): sem isto o laco nao andaria. Cresce ate caber.
      const maior = texto.slice(base, Math.min(texto.length, base + JANELA * 8))
      const primeiro = grafemasDaJanela(maior).next().value
      const pedaco = primeiro?.grafema ?? texto.slice(base, base + 1)
      yield { texto: pedaco, ansi: false }
      consumido = pedaco.length
    }
    base += consumido
  }
}

interface GrafemaNaJanela {
  readonly grafema: string
  readonly indice: number
}

function* grafemasDaJanela(janela: string): Generator<GrafemaNaJanela> {
  // ASCII imprimivel nao precisa do segmentador — e a janela e curta, entao o teste
  // e barato e nao volta a ser O(|s|).
  if (SO_ASCII_IMPRIMIVEL.test(janela)) {
    for (let i = 0; i < janela.length; i++) yield { grafema: janela[i] ?? '', indice: i }
    return
  }
  for (const parte of SEGMENTADOR.segment(janela)) yield { grafema: parte.segment, indice: parte.index }
}

export interface LarguraAte {
  // Colunas consumidas ate parar.
  readonly colunas: number
  // Indice em code units do primeiro grafema NAO consumido.
  readonly indice: number
  // true se a varredura parou por ter passado do teto (e nao por fim de texto).
  readonly excedeu: boolean
}

// Acumula largura e PARA no primeiro grafema que passaria de `teto`. Custo
// O(min(n, teto)) — e a resposta do early-return e o ponto de corte no mesmo passo.
// Ignora ANSI (largura zero) mas conta os code units dele em `indice`.
export function larguraAte(texto: string, teto: number): LarguraAte {
  let colunas = 0
  let indice = 0
  for (const pedaco of pedacosDe(texto)) {
    if (pedaco.ansi) { indice += pedaco.texto.length; continue }
    const largura = larguraDeGrafema(pedaco.texto)
    if (colunas + largura > teto) return { colunas, indice, excedeu: true }
    colunas += largura
    indice += pedaco.texto.length
  }
  return { colunas, indice, excedeu: false }
}
