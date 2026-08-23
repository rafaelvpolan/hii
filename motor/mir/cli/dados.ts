import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cardsDir } from '../../cdl/ali/config'
import { allCards, listRepos, normalizeId } from '../../cdl/store'
import { memoArquivo, memoTempo } from '../../tmd/eco/memo'
import { parseLog } from '../atividade'

export { passosAtivos, planoDoCard, passosDe } from '../../nmy/passos'

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
