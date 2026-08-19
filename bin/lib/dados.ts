import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cardsDir } from '../../lib/runner/config'
import { allCards, listRepos, normalizeId } from '../../lib/runner/card-store'
import { memoArquivo, memoTempo } from '../../lib/core/cache'
import { parseLog } from '../../lib/core/activity'

export { passosAtivos, planoDoCard, passosDe } from '../../lib/core/passos'

export const atividadeDe = memoArquivo(
  (id) => join(cardsDir(), 'runs', `${normalizeId(id)}.live.log`),
  (id: string): ReturnType<typeof parseLog> => {
    try {
      return parseLog(readFileSync(join(cardsDir(), 'runs', `${normalizeId(id)}.live.log`), 'utf8'))
    } catch {
      return []
    }
  },
)

export const todosOsCards = memoTempo(() => allCards(), 250)
export const reposRegistrados = memoTempo(() => listRepos(), 2000)

export function larguraUtil(): number {
  return Math.max(40, (Number(process.stdout.columns) || 78) - 6)
}
