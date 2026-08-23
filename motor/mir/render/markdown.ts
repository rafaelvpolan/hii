const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const ITALICO = '\x1b[3m'
const RISCADO = '\x1b[9m'
const CIANO = '\x1b[36m'

export interface OpcoesDeMarkdown {
  color: boolean
  largura: number
}

const PADRAO: OpcoesDeMarkdown = { color: false, largura: 78 }

const CERCA = /^\s*(```|~~~)(.*)$/
const CABECALHO = /^(#{1,6})\s+(.*)$/
const MARCADOR = /^(\s*)[-*+]\s+(.*)$/
const NUMERADO = /^(\s*)(\d{1,3}[.)])\s+(.*)$/
const CITACAO = /^\s*>\s?(.*)$/
const REGUA = /^\s*([-*_])(\s*\1){2,}\s*$/
const SEPARADOR_DE_TABELA = /^\s*\|?[\s:|-]+\|[\s:|-]*$/
const TAREFA = /^(\s*)[-*+]\s+\[( |x|X)\]\s+(.*)$/

const PROTEGIDO = '\x00'

function pintar(texto: string, cor: string, o: OpcoesDeMarkdown): string {
  return o.color ? `${cor}${texto}${RESET}` : texto
}

interface Protecao {
  texto: string
  guardados: string[]
}

function protegerCodigo(linha: string): Protecao {
  const guardados: string[] = []
  const texto = linha.replace(/`([^`]+)`/g, (_m, dentro: string) => {
    guardados.push(dentro)
    return `${PROTEGIDO}${guardados.length - 1}${PROTEGIDO}`
  })
  return { texto, guardados }
}

function devolverCodigo(linha: string, guardados: string[], o: OpcoesDeMarkdown): string {
  return linha.replace(new RegExp(`${PROTEGIDO}(\\d+)${PROTEGIDO}`, 'g'), (_m, n: string) => {
    const dentro = guardados[Number(n)] ?? ''
    return pintar(dentro, CIANO, o)
  })
}

export function inline(linha: string, o: OpcoesDeMarkdown): string {
  const p = protegerCodigo(linha)
  let texto = p.texto
  texto = texto.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_m, rotulo: string, url: string) => (
    `${rotulo} ${pintar(url, DIM, o)}`
  ))
  texto = texto.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, (_m, _marca: string, dentro: string) => pintar(dentro, BOLD, o))
  texto = texto.replace(/~~(?=\S)([\s\S]*?\S)~~/g, (_m, dentro: string) => pintar(dentro, RISCADO, o))
  texto = texto.replace(/(^|[\s(])[*_](?=\S)([^*_]*?\S)[*_](?=[\s.,;:)!?]|$)/g, (_m, antes: string, dentro: string) => (
    `${antes}${pintar(dentro, ITALICO, o)}`
  ))
  return devolverCodigo(texto, p.guardados, o)
}

function linhaDeCodigo(linha: string, o: OpcoesDeMarkdown): string {
  return `  ${pintar(linha || ' ', CIANO, o)}`
}

export function markdownParaAnsi(texto: string, opts: Partial<OpcoesDeMarkdown> = {}): string[] {
  const o = { ...PADRAO, ...opts }
  const saida: string[] = []
  let dentroDeCodigo = false

  for (const bruta of texto.replace(/\r\n?/g, '\n').split('\n')) {
    const cerca = CERCA.exec(bruta)
    if (cerca) {
      dentroDeCodigo = !dentroDeCodigo
      const lingua = dentroDeCodigo ? (cerca[2] ?? '').trim() : ''
      saida.push(pintar(lingua ? `  ── ${lingua}` : '  ──', DIM, o))
      continue
    }
    if (dentroDeCodigo) {
      saida.push(linhaDeCodigo(bruta, o))
      continue
    }
    if (!bruta.trim()) {
      saida.push('')
      continue
    }
    if (REGUA.test(bruta)) {
      saida.push(pintar('─'.repeat(Math.max(4, Math.min(o.largura, 40))), DIM, o))
      continue
    }
    const cab = CABECALHO.exec(bruta)
    if (cab) {
      const nivel = (cab[1] ?? '#').length
      const titulo = inline(cab[2] ?? '', o)
      saida.push(nivel <= 2 ? pintar(titulo, BOLD, o) : pintar(titulo, `${BOLD}${DIM}`, o))
      continue
    }
    const tarefa = TAREFA.exec(bruta)
    if (tarefa) {
      const marca = (tarefa[2] ?? ' ').toLowerCase() === 'x' ? '✓' : '○'
      saida.push(`${tarefa[1] ?? ''}${pintar(marca, CIANO, o)} ${inline(tarefa[3] ?? '', o)}`)
      continue
    }
    const item = MARCADOR.exec(bruta)
    if (item) {
      saida.push(`${item[1] ?? ''}${pintar('•', CIANO, o)} ${inline(item[2] ?? '', o)}`)
      continue
    }
    const num = NUMERADO.exec(bruta)
    if (num) {
      saida.push(`${num[1] ?? ''}${pintar(num[2] ?? '', CIANO, o)} ${inline(num[3] ?? '', o)}`)
      continue
    }
    const cit = CITACAO.exec(bruta)
    if (cit) {
      saida.push(`${pintar('│', DIM, o)} ${pintar(inline(cit[1] ?? '', o), DIM, o)}`)
      continue
    }
    if (SEPARADOR_DE_TABELA.test(bruta) && bruta.includes('|')) {
      saida.push(pintar(bruta, DIM, o))
      continue
    }
    saida.push(inline(bruta, o))
  }

  if (dentroDeCodigo) saida.push(pintar('  ──', DIM, o))
  return saida
}
