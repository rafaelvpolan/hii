import { isoNow } from '../../cordel/index.ts'
import type { Job, Fields } from '../../cordel/index.ts'
import { allCards, cardsByStatus, patchCard, readCard } from '../../cordel/store.ts'
import { marcarOrfao, prOrfaoDe } from '../../quilombo/salvo-conduto/compensacao.ts'
import { activeSteps } from '../../niemeyer/config.ts'
import { RESUME_POST_STEPS } from '../../quilombo/cartorio/retomar.ts'
import { encerrando } from './encerramento.ts'

const FINISH_STATES = ['REFINED', 'TESTS_GREEN', 'SEC_CLEARED', 'REVIEWED', 'CLEANED']
const RERUN_STATES = ['EXECUTING', 'CORRECTING', 'SPECCED']

const emVoo = new Set<string>()

const COOLDOWN_MS = Number(process.env.HICODE_CARD_COOLDOWN_MS || 0) || 30_000

const emCooldownAte = new Map<string, number>()

export function registrarRetornoSemTransicao(id: string, agoraMs = Date.now()): void {
  emCooldownAte.set(id, agoraMs + COOLDOWN_MS)
}

export function esquecerCooldowns(): void {
  emCooldownAte.clear()
}

function aindaEmCooldown(id: string, agoraMs: number): boolean {
  const ate = emCooldownAte.get(id)
  if (ate === undefined) return false
  if (agoraMs >= ate) {
    emCooldownAte.delete(id)
    return false
  }
  return true
}

export function assinaturaDaFila(): string {
  return allCards().map(c => `${c.id ?? ''}:${c.status ?? ''}`).sort().join('|')
}

export function marcarEmVoo(id: string): void {
  emVoo.add(id)
}

export function liberar(id: string): void {
  emVoo.delete(id)
}

export function quantosEmVoo(): number {
  return emVoo.size
}

function resumeAposEstado(estadoQueOPassoPagoGravou: string, worktree: string): string {
  const passos = activeSteps(worktree || undefined)
  const indiceDoPassoJaPago = passos.findIndex(p => p.state === estadoQueOPassoPagoGravou)
  if (indiceDoPassoJaPago < 0) return ''
  return passos[indiceDoPassoJaPago + 1]?.label ?? RESUME_POST_STEPS
}

export function reconcileStranded(): void {
  for (const s of FINISH_STATES) {
    for (const c of cardsByStatus(s)) {
      const id = c.id ?? ''
      // Antes de reiniciar o finish: o PR pode JA existir. O diario do card
      // sabe disso mesmo quando o frontmatter nao sabe — foi o crash entre o
      // `gh pr create` e o patchCard que deixou os dois em desacordo. Reiniciar
      // o finish aqui abriria um segundo PR (Parte VI, secao 3).
      const orfao = prOrfaoDe(id, String(c.pr_url ?? ''))
      if (orfao) {
        marcarOrfao(id, 'pr_orfao', `PR ${orfao.url} constava no diario mas nao no card; card estava em ${s}`)
        patchCard(id, { status: 'PR_OPEN', pr_url: orfao.url }, `${isoNow()} ${s}->PR_OPEN o PR ${orfao.url} ja tinha sido aberto antes do reinicio — adotado em vez de reaberto`)
        process.stdout.write(`[runner] #${id}: PR orfao adotado (${orfao.url}) — nao foi aberto de novo\n`)
        continue
      }
      const resume = resumeAposEstado(s, String(c.worktree ?? ''))
      const campos: Fields = resume ? { status: 'URL_OK', resume_from: resume } : { status: 'URL_OK' }
      patchCard(id, campos, `${isoNow()} ${s}->URL_OK recuperado apos reinicio do daemon (finish reiniciado${resume ? ` retomando de "${resume}" — passo ja pago nao repete` : ''})`)
      process.stdout.write(`[runner] #${id}: recuperado ${s}->URL_OK${resume ? ` (retoma de ${resume})` : ''}\n`)
    }
  }
  for (const s of RERUN_STATES) {
    for (const c of cardsByStatus(s)) {
      if (c.reconciled !== s) {
        patchCard(c.id ?? '', { reconciled: s }, `${isoNow()} ${s} interrompido por reinicio do daemon — sera reexecutado`)
      }
      process.stdout.write(`[runner] #${c.id}: ${s} interrompido, reexecutando apos reinicio\n`)
    }
  }
  for (const c of cardsByStatus('EXECUTED')) {
    patchCard(c.id ?? '', { status: 'EXECUTING' }, `${isoNow()} EXECUTED->EXECUTING recuperado (url nao concluido ou rejeitado sem worktree — nao havia consumidor de EXECUTED)`)
    process.stdout.write(`[runner] #${c.id}: recuperado EXECUTED->EXECUTING\n`)
  }
}

export function halteradosDoLote(ids: readonly string[]): string[] {
  return ids.filter(id => readCard(id)?.fm.status === 'HALTED')
}

export function pending(): Job[] {
  // Drenando: nao entrega trabalho novo. O que ja esta em voo termina; o resto
  // fica no disco esperando o proximo arranque.
  if (encerrando()) return []
  const cards = allCards()
  const porStatus = (status: string): Array<Fields & { file: string }> => cards.filter(c => c.status === status)
  const ex: Job[] = porStatus('EXECUTING').map(c => ({ kind: 'execute', id: c.id ?? '' }))
  const fi: Job[] = porStatus('URL_OK').map(c => ({ kind: 'finish', id: c.id ?? '' }))
  const co: Job[] = porStatus('CORRECTING').map(c => ({ kind: 'correct', id: c.id ?? '' }))
  const sp: Job[] = porStatus('SPECCED').map(c => ({ kind: 'spec', id: c.id ?? '' }))
  const agoraMs = Date.now()
  return [...sp, ...ex, ...fi, ...co].filter(j => !emVoo.has(j.id) && !aindaEmCooldown(j.id, agoraMs))
}
