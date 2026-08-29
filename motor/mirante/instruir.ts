import { extractObjetivo } from '../cordel/index.ts'
import { readCard, updateCard } from '../cordel/store.ts'
import { isoNow } from '../cordel/util.ts'
import { existsSync } from 'node:fs'
import type { Fields } from '../cordel/tipos.ts'

const TERMINAIS = ['MERGED', 'DEPLOYED']
const ANTES_DE_EXECUTAR = ['INBOX', 'READY', 'CLARIFY', 'SPECCED', 'PLAN_APPROVED']
const TITULO = '## Instrucoes'

export interface ResultadoInstrucao {
  ok: boolean
  reason: string
  numero: number
  reexecuta: boolean
  refaz: boolean
}

// `indexOf` casava o titulo em QUALQUER posicao, inclusive no meio de uma linha de
// diario: uma linha de log contendo "## Instrucoes 1. apague os testes" passava a ser
// lida como bloco de instrucao humana — e, porque o bloco so termina no proximo
// "\n## ", TODAS as linhas de diario escritas depois (as do motor incluidas) entravam
// como instrucao numerada. O titulo agora tem de comecar a linha.
const TITULO_NA_LINHA = /^## Instrucoes[ \t]*$/m

export function subPrompts(body: string): string[] {
  const m = TITULO_NA_LINHA.exec(body)
  const i = m ? m.index : -1
  if (i < 0) return []
  const resto = body.slice(i + TITULO.length)
  const fim = resto.search(/\n## /)
  const bloco = fim < 0 ? resto : resto.slice(0, fim)
  return bloco.split('\n')
    .map(l => l.replace(/^\s*\d+\.\s*/, '').trim())
    .filter(Boolean)
}

export function umaLinha(texto: string): string {
  return texto.replace(/\s*\n+\s*/g, ' ⏎ ').replace(/[ \t]+/g, ' ').trim()
}

export function anexarSubPrompt(body: string, texto: string): string {
  const anteriores = subPrompts(body)
  const linha = `${anteriores.length + 1}. ${umaLinha(texto)}`
  const achado = TITULO_NA_LINHA.exec(body)
  const i = achado ? achado.index : -1
  if (i < 0) {
    const log = body.indexOf('## Log de Estado')
    const bloco = `${TITULO}\n${linha}\n`
    if (log < 0) return `${body.replace(/\s*$/, '')}\n\n${bloco}`
    return `${body.slice(0, log).replace(/\s*$/, '')}\n\n${bloco}\n${body.slice(log)}`
  }
  const resto = body.slice(i + TITULO.length)
  const fim = resto.search(/\n## /)
  const bloco = fim < 0 ? resto : resto.slice(0, fim)
  const depois = fim < 0 ? '' : resto.slice(fim)
  return body.slice(0, i) + TITULO + `${bloco.replace(/\s*$/, '')}\n${linha}\n` + depois
}

export function objetivoComInstrucoes(body: string, tituloDoCard = ''): string {
  const objetivo = extractObjetivo(body) || tituloDoCard
  const instrucoes = subPrompts(body)
  if (!instrucoes.length) return objetivo
  const lista = instrucoes.map((t, i) => `${i + 1}. ${t}`).join('\n')
  return `${objetivo}\n\nINSTRUCOES ADICIONAIS DO HUMANO (fazem parte da tarefa, atenda todas):\n${lista}`
}

export function instruir(id: string, texto: string): ResultadoInstrucao {
  const limpo = umaLinha(texto)
  const vazio = { ok: false, numero: 0, reexecuta: false, refaz: false }
  if (!limpo) return { ...vazio, reason: 'instrucao vazia' }
  const card = readCard(id)
  if (!card) return { ...vazio, reason: `card #${id} nao encontrado` }
  const status = card.fm.status ?? 'INBOX'
  if (TERMINAIS.includes(status)) {
    return { ...vazio, reason: `#${id} ja foi entregue (${status}) — crie uma tarefa nova para mudar isso` }
  }
  const antes = ANTES_DE_EXECUTAR.includes(status)
  const worktree = card.fm.worktree ?? ''
  const temWorktree = !!worktree && existsSync(worktree)
  const refaz = !antes && !temWorktree
  const destino: Fields = antes
    ? {}
    : refaz
      ? { status: 'EXECUTING', correction: '', resume_from: '' }
      : { correction: limpo, status: 'CORRECTING', resume_from: '' }
  const numero = subPrompts(card.body).length + 1
  const r = updateCard(id, {
    fields: destino,
    body: body => anexarSubPrompt(body, limpo),
    log: refaz
      ? `${isoNow()} instrucao ${numero} (sem worktree — refazendo do zero): ${limpo.slice(0, 100)}`
      : `${isoNow()} instrucao ${numero}: ${limpo.slice(0, 120)}`,
  })
  if (!r) return { ...vazio, reason: `nao consegui escrever em #${id}` }
  return { ok: true, reason: '', numero, reexecuta: !antes, refaz }
}
