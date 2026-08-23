import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cardsDir, reposFile } from '../../cdl/ali/config'
import { allCards, listRepos, normalizeId } from '../../cdl/store'
import { memoArquivo, memoChave, memoTempo } from '../../tmd/eco/memo'
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

// memoChave por cima do memoTempo, como mapaDeReposPorDiretorio e
// lotePorDiretorio ja fazem. Sem a chave de diretorio, um cache de 250ms
// puramente temporal devolve a lista de cards de OUTRO diretorio quando o
// HICODE_CARDS_DIR muda dentro da mesma janela — foi assim que o rodape
// respondeu com um card que nao existia no diretorio pedido.
const cardsPorDiretorio = memoChave(cardsDir, (): (() => ReturnType<typeof allCards>) => memoTempo(() => allCards(), 250))
const reposPorArquivo = memoChave(reposFile, (): (() => ReturnType<typeof listRepos>) => memoTempo(() => listRepos(), 2000))

export function todosOsCards(): ReturnType<typeof allCards> {
  return cardsPorDiretorio()()
}

export function reposRegistrados(): ReturnType<typeof listRepos> {
  return reposPorArquivo()()
}

export function larguraUtil(): number {
  return Math.max(40, (Number(process.stdout.columns) || 78) - 6)
}
