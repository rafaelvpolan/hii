import { isoNow } from '../../cdl'
import type { Job, Fields } from '../../cdl'
import { allCards, cardsByStatus, patchCard } from '../../cdl/store'

const FINISH_STATES = ['REFINED', 'TESTS_GREEN', 'SEC_CLEARED', 'REVIEWED', 'CLEANED']
const RERUN_STATES = ['EXECUTING', 'CORRECTING', 'SPECCED']

const emVoo = new Set<string>()

export function marcarEmVoo(id: string): void {
  emVoo.add(id)
}

export function liberar(id: string): void {
  emVoo.delete(id)
}

export function quantosEmVoo(): number {
  return emVoo.size
}

export function reconcileStranded(): void {
  for (const s of FINISH_STATES) {
    for (const c of cardsByStatus(s)) {
      patchCard(c.id ?? '', { status: 'URL_OK' }, `${isoNow()} ${s}->URL_OK recuperado apos reinicio do daemon (finish reiniciado)`)
      process.stdout.write(`[runner] #${c.id}: recuperado ${s}->URL_OK\n`)
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

export function pending(): Job[] {
  const cards = allCards()
  const porStatus = (status: string): Array<Fields & { file: string }> => cards.filter(c => c.status === status)
  const ex: Job[] = porStatus('EXECUTING').map(c => ({ kind: 'execute', id: c.id ?? '' }))
  const fi: Job[] = porStatus('URL_OK').map(c => ({ kind: 'finish', id: c.id ?? '' }))
  const co: Job[] = porStatus('CORRECTING').map(c => ({ kind: 'correct', id: c.id ?? '' }))
  const sp: Job[] = porStatus('SPECCED').map(c => ({ kind: 'spec', id: c.id ?? '' }))
  return [...sp, ...ex, ...fi, ...co].filter(j => !emVoo.has(j.id))
}
