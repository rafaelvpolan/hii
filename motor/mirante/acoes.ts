import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { appendLog, isoNow, setObjetivo, slugify, tituloDe } from '../cordel/index.ts'
import type { Fields } from '../cordel/index.ts'
import { cardsDir, rigorEstrito } from '../cordel/alicerce/config.ts'
import { createCard, findCardFile, patchCard, readCard, updateCard } from '../cordel/store.ts'
import { readClarify, writeClarify } from '../agentes/clarice/clarificar.ts'
import { conferirParedeDoPlano } from '../quilombo/cartorio/aprovar-plano.ts'
import { CONFIRMADO } from '../quilombo/cartorio/confirmar-fecho.ts'
import { RESUME_POST_STEPS } from '../quilombo/cartorio/retomar.ts'

export interface NewCardInput {
  title: string
  repo?: string
  risk?: string
  desc?: string
  layout?: string
  pilha?: string
  ai?: string
  effort?: string
  packs?: string
  steps?: string
}

export interface ClarifyAnswer {
  q: string
  answer: string
}

export type ActionResult = Fields | null

function optional(fields: Record<string, string | undefined>): Fields {
  const out: Fields = {}
  for (const [k, v] of Object.entries(fields)) if (v) out[k] = v
  return out
}

export function submit(input: NewCardInput): string {
  const objetivo = (input.desc ?? '').trim() || input.title
  const body = `## Objetivo\n${objetivo}\n\n## Log de Estado\n${isoNow()} CREATED status=READY`
  return createCard({
    slug: slugify(tituloDe(input.title)),
    title: tituloDe(input.title),
    status: 'READY',
    risk: input.risk === 'high' ? 'high' : 'low',
    repo: input.repo ?? '',
    created: isoNow(),
    ...optional({ layout: input.layout, pilha: input.pilha, ai: input.ai, effort: input.effort, packs: input.packs, steps: input.steps }),
  }, body)
}

export function transition(id: string, status: string, note?: string): ActionResult {
  return updateCard(id, {
    fields: { status },
    log: fm => `${isoNow()} ${fm.status || 'INBOX'}->${status}${note ? ' ' + note : ''}`,
  })
}

export function resumeFrom(id: string, step: string): ActionResult {
  return updateCard(id, {
    fields: { resume_from: step, status: 'URL_OK' },
    log: fm => `${isoNow()} ${fm.status || 'INBOX'}->URL_OK replay a partir de ${step}`,
  })
}

export const PRE_EXECUCAO = ['INBOX', 'READY', 'CLARIFY', 'SPECCED', 'PLAN_APPROVED', 'PAUSED']

export type MotivoDeRecusa = 'nao-encontrado' | 'estado' | 'parede'

export interface GuardedResult {
  ok: boolean
  reason: string
  motivo?: MotivoDeRecusa
  card?: Fields
}

export function approveUrl(id: string): GuardedResult {
  const card = readCard(id)
  if (!card) return { ok: false, reason: `card #${id} nao encontrado` }
  const status = card.fm.status ?? 'INBOX'
  if (status !== 'URL') {
    return { ok: false, reason: `#${id} esta em ${status} — so da para aprovar url de card em URL` }
  }
  const r = transition(id, 'URL_OK', 'url aprovado pelo humano')
  return r ? { ok: true, reason: '', card: r } : { ok: false, reason: `card #${id} nao encontrado` }
}

export function rejectUrl(id: string, motivo: string): GuardedResult {
  const card = readCard(id)
  if (!card) return { ok: false, reason: `card #${id} nao encontrado` }
  const status = card.fm.status ?? 'INBOX'
  if (status !== 'URL') {
    return { ok: false, reason: `#${id} esta em ${status} — so da para rejeitar url de card em URL` }
  }
  const wt = card.fm.worktree ?? ''
  const temWorktree = !!wt && existsSync(join(wt, '.git'))
  const razao = motivo.trim()
  // Sem motivo = REFAZER DO ZERO, e agora isso e dito explicitamente. Antes o
  // "do zero" vinha de efeito colateral: `ensureWorktree` apagava o worktree em
  // TODA execucao. Quando o reuso virou padrao (para a retomada parar de refazer o
  // que ja estava feito), o pedido de refazer precisou de marca propria.
  if (!razao || !temWorktree) {
    patchCard(id, { refazer: 'true' }, `${isoNow()} url rejeitado sem ajuste pedido — o worktree sera recriado do zero`)
  }
  const r = razao && temWorktree
    ? requestCorrection(id, '', razao)
    : transition(id, 'EXECUTING', razao ? `url rejeitado: ${razao} — reexecutando` : 'url rejeitado — reexecutando')
  return r ? { ok: true, reason: '', card: r } : { ok: false, reason: `nao foi possivel rejeitar #${id}` }
}

export function confirmarFecho(id: string): GuardedResult {
  const card = readCard(id)
  if (!card) return { ok: false, reason: `card #${id} nao encontrado`, motivo: 'nao-encontrado' }
  const status = card.fm.status ?? 'INBOX'
  if (status !== 'CONFIRM') {
    return { ok: false, reason: `#${id} esta em ${status} — so da para encerrar card que pediu confirmacao`, motivo: 'estado' }
  }
  const r = updateCard(id, {
    fields: { fecho_confirmado: CONFIRMADO, status: 'URL_OK', resume_from: RESUME_POST_STEPS },
    log: () => `${isoNow()} CONFIRM->URL_OK voce confirmou que resolveu — encerrando e abrindo o PR (nenhum passo repetido)`,
  })
  return r ? { ok: true, reason: '', card: r } : { ok: false, reason: `card #${id} nao encontrado`, motivo: 'nao-encontrado' }
}

export function recusarFecho(id: string, motivo: string): GuardedResult {
  const card = readCard(id)
  if (!card) return { ok: false, reason: `card #${id} nao encontrado`, motivo: 'nao-encontrado' }
  const status = card.fm.status ?? 'INBOX'
  if (status !== 'CONFIRM') {
    return { ok: false, reason: `#${id} esta em ${status} — so da para recusar o fecho de card que pediu confirmacao`, motivo: 'estado' }
  }
  const razao = motivo.trim()
  const wt = card.fm.worktree ?? ''
  const temWorktree = !!wt && existsSync(join(wt, '.git'))
  if (!razao) {
    return { ok: false, reason: `#${id}: diga o que ainda falta — sem isso o motor repetiria o mesmo trabalho`, motivo: 'estado' }
  }
  if (!temWorktree) {
    const r = updateCard(id, {
      fields: { correction: razao, status: 'EXECUTING', refazer: 'true', resume_from: '' },
      log: () => `${isoNow()} CONFIRM->EXECUTING nao resolveu (${razao}) — worktree ja nao existe, refazendo do zero`,
    })
    return r ? { ok: true, reason: '', card: r } : { ok: false, reason: `card #${id} nao encontrado`, motivo: 'nao-encontrado' }
  }
  const r = updateCard(id, {
    fields: { correction: razao, correction_file: '', correction_line: '', correction_line_text: '', status: 'CORRECTING', resume_from: '' },
    log: () => `${isoNow()} CONFIRM->CORRECTING nao resolveu: ${razao}`,
  })
  return r ? { ok: true, reason: '', card: r } : { ok: false, reason: `card #${id} nao encontrado`, motivo: 'nao-encontrado' }
}

export function canApprovePlan(status: string): boolean {
  return PRE_EXECUCAO.includes(status)
}

export function approvePlan(id: string): GuardedResult {
  const card = readCard(id)
  if (!card) return { ok: false, reason: `card #${id} nao encontrado`, motivo: 'nao-encontrado' }
  const status = card.fm.status ?? 'INBOX'
  if (!canApprovePlan(status)) {
    return { ok: false, reason: `#${id} esta em ${status} — o plano ja foi executado; aprovar aqui descartaria o trabalho e pagaria de novo`, motivo: 'estado' }
  }
  const parede = conferirParedeDoPlano(id)
  patchCard(id, { matriz_entendimento: parede.satisfeito ? 'ok' : 'incompleta' }, `${isoNow()} CTR (Fase 4): ${parede.motivo}`)
  if (!parede.satisfeito && rigorEstrito()) {
    return { ok: false, reason: `#${id} nao pode ser aprovado: ${parede.motivo}`, motivo: 'parede' }
  }
  const r = transition(id, 'EXECUTING', 'plano aprovado')
  return r ? { ok: true, reason: '', card: r } : { ok: false, reason: `card #${id} nao encontrado`, motivo: 'nao-encontrado' }
}

export function halt(id: string, reason: string): ActionResult {
  return transition(id, 'HALTED', reason)
}

export function requestCorrection(id: string, file: string, instruction: string, line = '', lineText = ''): ActionResult {
  const card = readCard(id)
  if (!card) return null
  if (card.fm.status !== 'URL') return null
  if (!card.fm.worktree || !existsSync(join(card.fm.worktree, '.git'))) return null
  const anchor = file ? `${file}${line ? ':' + line : ''}` : '(geral)'
  return updateCard(id, {
    fields: {
      correction: instruction,
      correction_file: file,
      correction_line: line,
      correction_line_text: lineText.replace(/[\r\n]+/g, ' '),
      status: 'CORRECTING',
    },
    log: fm => `${isoNow()} ${fm.status || 'INBOX'}->CORRECTING correção: ${anchor} — ${instruction.slice(0, 120)}`,
  })
}

export function answerClarify(id: string, answers: ClarifyAnswer[]): ActionResult {
  const questions = readClarify(id)
  if (!questions.length) return null
  for (const a of answers) {
    const match = questions.find(q => q.q === a.q)
    if (match) match.answer = a.answer
  }
  writeClarify(id, questions)
  return updateCard(id, {
    fields: { clarified: 'true', status: 'EXECUTING' },
    log: `${isoNow()} CLARIFY->EXECUTING respondido (${answers.length} resposta(s))`,
  })
}

export interface EditInput {
  title?: string
  desc?: string
  risk?: string
}

export function edit(id: string, fields: EditInput): ActionResult {
  const card = readCard(id)
  if (!card) return null
  const pausa = card.fm.status === 'EXECUTING'
  const title = fields.title?.trim()
  const desc = fields.desc?.trim()
  return updateCard(id, {
    fields: {
      ...optional({ title, risk: fields.risk === 'high' || fields.risk === 'low' ? fields.risk : undefined }),
      ...(pausa ? { status: 'PAUSED' } : {}),
    },
    body: body => (desc ? setObjetivo(body, desc) : body),
    log: pausa ? `${isoNow()} EXECUTING->PAUSED editado (auto-pausa)` : `${isoNow()} EDIT tarefa`,
  })
}

export function setUrlPid(id: string, pid: number, hard = false): ActionResult {
  return updateCard(id, {
    fields: { url_pid: String(pid) },
    log: `${isoNow()} RESET url reiniciado (pid ${pid}${hard ? ', cache limpo' : ''})`,
  })
}

export function remove(id: string): boolean {
  const f = findCardFile(id)
  if (!f) return false
  rmSync(join(cardsDir(), f))
  const prev = join(cardsDir(), 'urls', String(id))
  if (existsSync(prev)) rmSync(prev, { recursive: true, force: true })
  return true
}

export { appendLog }
