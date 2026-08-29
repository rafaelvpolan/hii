import { isoNow } from '../../cordel/index.ts'
import type { Job, Fields } from '../../cordel/index.ts'
import { allCards, cardsByStatus, patchCard } from '../../cordel/store.ts'
import { marcarOrfao, prOrfaoDe } from '../../quilombo/salvo-conduto/compensacao.ts'
import { encerrando } from './encerramento.ts'

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
      patchCard(id, { status: 'URL_OK' }, `${isoNow()} ${s}->URL_OK recuperado apos reinicio do daemon (finish reiniciado)`)
      process.stdout.write(`[runner] #${id}: recuperado ${s}->URL_OK\n`)
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
  // Drenando: nao entrega trabalho novo. O que ja esta em voo termina; o resto
  // fica no disco esperando o proximo arranque.
  if (encerrando()) return []
  const cards = allCards()
  const porStatus = (status: string): Array<Fields & { file: string }> => cards.filter(c => c.status === status)
  const ex: Job[] = porStatus('EXECUTING').map(c => ({ kind: 'execute', id: c.id ?? '' }))
  const fi: Job[] = porStatus('URL_OK').map(c => ({ kind: 'finish', id: c.id ?? '' }))
  const co: Job[] = porStatus('CORRECTING').map(c => ({ kind: 'correct', id: c.id ?? '' }))
  const sp: Job[] = porStatus('SPECCED').map(c => ({ kind: 'spec', id: c.id ?? '' }))
  return [...sp, ...ex, ...fi, ...co].filter(j => !emVoo.has(j.id))
}
