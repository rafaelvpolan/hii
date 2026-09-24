import { allCards, createCard, updateCard } from '../../../cordel/store.ts'
import { taskSync, taskSyncInvalido } from './registro.ts'

export interface SyncReport {
  pulled: number
  created: number
  pushed: number
  // Falha NOMEADA, nao engolida. `ok: false` faz o CLI sair diferente de zero:
  // "N espelhados" com exit 0 sobre uma sincronizacao que nao falou com o GitHub
  // era verde sobre trabalho nao feito no unico comando que existe para produzir
  // efeito externo.
  falhas: string[]
  ok: boolean
  // Cards cujo comentario JA constava no diario: nada foi postado nesta execucao.
  // Somar isso a `pushed` imprimia "N espelhados" para efeito que nao aconteceu.
  reaproveitados: number
}

function detalhe(e: Error): string {
  return String(e?.message ?? e).slice(0, 300)
}

export async function runSync(): Promise<SyncReport> {
  const invalido = taskSyncInvalido()
  if (invalido) return { pulled: 0, created: 0, pushed: 0, falhas: [invalido], ok: false, reaproveitados: 0 }
  const sync = taskSync()
  if (!sync) return { pulled: 0, created: 0, pushed: 0, falhas: [], ok: true, reaproveitados: 0 }
  const cards = allCards()
  const seen = new Set(cards.map(c => c.source).filter(Boolean))
  const falhas: string[] = []
  let external: Awaited<ReturnType<typeof sync.pull>> = []
  let leu = false
  try {
    external = await sync.pull()
    leu = true
  } catch (e) {
    falhas.push(`pull: ${detalhe(e as Error)}`)
  }
  let created = 0
  const terminais = new Set(['MERGED', 'DEPLOYED', 'COMPLETED'])
  for (const t of external) {
    const source = t.source ?? `${sync.name}#${t.externalId}`
    const existentes = cards.filter(c => c.source === source)
    if (existentes.length) {
      for (const card of existentes) {
        const bloqueada = t.estado === 'closed' || (t.bloqueios?.length ?? 0) > 0
        const fields = { tracker_state: t.estado ?? 'open', tracker_blockers: (t.bloqueios ?? []).join(','), tracker_priority: t.prioridade ?? '' }
        updateCard(String(card.id), { fields: bloqueada && !terminais.has(String(card.status)) ? { ...fields, status: 'PAUSED' } : fields,
          log: bloqueada && card.status !== 'PAUSED' && !terminais.has(String(card.status)) ? `tracker ${t.estado === 'closed' ? 'fechado' : 'bloqueado'}; card pausado sem retomada automatica` : '' })
      }
      continue
    }
    if (t.estado === 'closed') continue
    const legado = t.source ? cards.filter(c => c.source === `${sync.name}#${t.externalId}`) : []
    if (legado.some(c => c.repo === t.repo)) continue
    if (legado.some(c => !c.repo)) {
      falhas.push(`origem legada ambigua de ${source}: associe o repositorio antes de importar`)
      continue
    }
    // Dentro do try: falha de escrita (ENOSPC/EACCES/cards read-only) fazia runSync
    // REJEITAR em vez de virar item em `falhas`, e o relato com exit code
    // desaparecia junto — cards criados antes da falha ficavam sem contabilizacao.
    try {
      const bloqueada = (t.bloqueios?.length ?? 0) > 0
      createCard({ status: bloqueada ? 'PAUSED' : 'READY', title: t.title, source, tracker_state: t.estado ?? 'open',
        tracker_blockers: (t.bloqueios ?? []).join(','), tracker_priority: t.prioridade ?? '', ...(t.repo ? { repo: t.repo } : {}) }, `## Objetivo\n${t.body || t.title}\n`)
      seen.add(source)
      created++
    } catch (e) {
      falhas.push(`criar card de ${source}: ${detalhe(e as Error)}`)
    }
  }
  // O push segue mesmo se o pull falhou: espelhar o estado dos cards que ja
  // existem nao depende de ter lido issue nova. Cada card falha por si — uma
  // issue apagada no remoto nao pode impedir o espelho dos outros cards.
  let pushed = 0
  let reaproveitados = 0
  for (const c of cards) {
    if (!(c.source && String(c.source).startsWith(`${sync.name}#`))) continue
    try {
      if (await sync.push(c)) pushed++
      else reaproveitados++
    } catch (e) {
      falhas.push(`push #${String(c.id ?? '?')}: ${detalhe(e as Error)}`)
    }
  }
  return { pulled: leu ? external.length : 0, created, pushed, falhas, ok: falhas.length === 0, reaproveitados }
}

export function relatoDeSync(nome: string, r: SyncReport): string {
  const jaEstavam = r.reaproveitados ? `, ${r.reaproveitados} ja espelhados antes` : ''
  const base = `sync (${nome}): ${r.created} cards criados, ${r.pushed} espelhados de ${r.pulled} externos${jaEstavam}`
  if (r.ok) return base
  return [`${base} — ${r.falhas.length} FALHA(S), o numero acima nao cobre o que nao aconteceu`, ...r.falhas.map(f => `  ! ${f}`)].join('\n')
}
