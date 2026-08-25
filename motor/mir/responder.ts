import { readClarify, writeClarify } from '../agentes/clr/clarificar.ts'
import { patchCard, readCard } from '../cdl/store.ts'
import { isoNow } from '../cdl/util.ts'
import { umaLinha } from './instruir.ts'
import { gravarPerguntasDoCrivo, perguntasDoCrivo } from '../cic/crv/perguntas-do-crivo.ts'
import { answerClarify } from './acoes.ts'
import type { ClarifyQuestion, Fields } from '../cdl/tipos.ts'

export type OrigemDaPergunta = 'clarify' | 'crivo'

export interface Pendencia {
  id: string
  titulo: string
  perguntas: ClarifyQuestion[]
  indice: number
  atual: ClarifyQuestion
  origem: OrigemDaPergunta
}

export interface RespostaResult {
  ok: boolean
  reason: string
  resposta: string
  restantes: number
  retomou: boolean
}

function naoRespondida(perguntas: ClarifyQuestion[]): number {
  return perguntas.findIndex(q => !q.answer)
}

export function pendencia(id: string): Pendencia | null {
  const card = readCard(id)
  if (!card) return null
  // Duas origens de pergunta, UMA superficie de resposta. A do CLARIFY vem antes de
  // executar; a do CRIVO vem depois, sobre a evidencia do que foi feito. Antes so a
  // primeira aparecia: a do crivo era gravada em `review_questions` e lida por
  // ninguem — o card parava com as perguntas dentro do frontmatter e a TUI dizia
  // apenas "a tarefa parou".
  const daRevisao = perguntasDoCrivo(card.fm, id)
  const doClarify = card.fm.status === 'CLARIFY' ? readClarify(id) : []
  const perguntas = doClarify.length ? doClarify : daRevisao
  if (!perguntas.length) return null
  const indice = naoRespondida(perguntas)
  const atual = perguntas[indice]
  if (!atual) return null
  return { id, titulo: card.fm.title ?? '', perguntas, indice, atual, origem: perguntas === daRevisao ? 'crivo' : 'clarify' }
}

export function cardsPerguntando(cards: Fields[], repo = ''): string[] {
  return cards
    .filter(c => c.status === 'CLARIFY' && (!repo || c.repo === repo))
    .map(c => c.id ?? '')
    .filter(Boolean)
}

export function resolverResposta(pergunta: ClarifyQuestion, entrada: string): string {
  const texto = entrada.trim()
  if (!texto || texto === 'r') return pergunta.recommended || pergunta.options[0] || ''
  if (/^\d{1,2}$/.test(texto)) {
    const escolha = pergunta.options[Number(texto) - 1]
    return escolha ?? ''
  }
  return texto
}

export function responder(id: string, entrada: string): RespostaResult {
  const vazio = { ok: false, resposta: '', restantes: 0, retomou: false }
  const p = pendencia(id)
  if (!p) {
    const card = readCard(id)
    if (!card) return { ...vazio, reason: `card #${id} nao encontrado` }
    return { ...vazio, reason: `#${id} esta em ${card.fm.status ?? 'INBOX'} — nao ha pergunta aberta` }
  }
  const resposta = resolverResposta(p.atual, entrada)
  if (!resposta) {
    return { ...vazio, reason: `opcao invalida — escolha de 1 a ${p.atual.options.length}, ou escreva a resposta` }
  }
  const perguntas = p.perguntas.map((q, i) => (i === p.indice ? { ...q, answer: resposta } : q))
  const restantes = perguntas.filter(q => !q.answer).length
  // A pergunta do CRIVO nao retoma o card: ela e sobre o que JA foi feito, e a
  // decisao de seguir continua sendo do humano (retomar, recusar, parar). Gravar a
  // resposta no card e no diario e o que faltava — sem isso ela nao chegaria nem ao
  // corpo do PR, que e onde o revisor a le.
  if (p.origem === 'crivo') {
    gravarPerguntasDoCrivo(id, perguntas)
    patchCard(id, restantes ? {} : { review_respondido: 'sim' },
      `${isoNow()} resposta ao crivo (${p.indice + 1}/${p.perguntas.length}): ${umaLinha(p.atual.q).slice(0, 90)} -> ${umaLinha(resposta).slice(0, 120)}`)
    return { ok: true, reason: '', resposta, restantes, retomou: false }
  }
  writeClarify(id, perguntas)
  if (restantes > 0) return { ok: true, reason: '', resposta, restantes, retomou: false }
  const pares = perguntas.map(q => ({ q: q.q, answer: q.answer ?? '' }))
  const r = answerClarify(id, pares)
  return { ok: !!r, reason: r ? '' : `nao foi possivel retomar #${id}`, resposta, restantes: 0, retomou: !!r }
}
