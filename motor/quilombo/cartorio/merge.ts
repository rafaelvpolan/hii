import { isoNow } from '../../cordel/index.ts'
import { run } from '../git.ts'
import { cardsByStatus, patchCard, repoPath } from '../../cordel/store.ts'
import { MERGE_POLL_MS } from '../../cordel/alicerce/config.ts'
import { anexarEvento, cardFechado } from '../../euclides/eventos.ts'
import { aprendizFechaCard } from '../../cascudo/freire/aprendiz.ts'
import { readContract } from '../../cordel/bussola/armazenar.ts'

// O merge e o unico momento em que o card acabou de verdade — e por isso e aqui
// que o aprendiz le o diario e o card e fechado.
//
// A ordem importa e tem teste: aprendiz PRIMEIRO. Fechar antes esconderia dele
// exatamente o rastro que ele existe para auditar.
//
// `card_fechado` era um tipo de evento que ninguem escrevia: recuperar.ts
// filtrava por ele e nunca filtrava nada, entao a retomada varria todo card que
// algum dia teve diario, para sempre. Era a degradacao que a Parte VI marca como
// o erro mais comum de checkpoint.

export async function aoMergear(card: string, alvo: string, dominio: string): Promise<void> {
  if (cardFechado(card)) return
  await aprendizFechaCard(card, { alvo, dominio })
  anexarEvento({ card, evento: 'card_fechado', detalhe: 'PR mergeada — card encerrado' })
}

interface PrState {
  state?: string
  mergedAt?: string | null
}

let lastCheck = 0
let checking = false

export async function checkMerged(now: number): Promise<void> {
  if (checking || now - lastCheck < MERGE_POLL_MS) return
  checking = true
  lastCheck = now
  try {
    for (const c of cardsByStatus('PR_OPEN')) {
      const url = c.pr_url
      if (!url) continue
      const { err, stdout } = await run('gh', ['pr', 'view', url, '--json', 'state,mergedAt'], { timeout: 20000 })
      if (err) continue
      let pr: PrState = {}
      try { pr = JSON.parse(stdout) as PrState } catch { continue }
      if (pr.state === 'MERGED') {
        patchCard(c.id ?? '', { status: 'MERGED', merged_at: pr.mergedAt || isoNow() }, `${isoNow()} PR_OPEN->MERGED PR mergeada no GitHub (merge humano) ${url}`)
        const alvo = repoPath(c.repo ?? '')
        await aoMergear(c.id ?? '', alvo, readContract(alvo)?.stack || 'desconhecido')
        process.stdout.write(`[runner] #${c.id}: MERGED ${url}\n`)
      } else if (pr.state === 'CLOSED' && c.pr_closed !== 'true') {
        patchCard(c.id ?? '', { pr_closed: 'true' }, `${isoNow()} PR ${url} fechada sem merge (rejeitada no GitHub) — card mantido em PR_OPEN`)
      }
    }
  } finally {
    checking = false
  }
}
