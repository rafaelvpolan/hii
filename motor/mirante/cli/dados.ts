import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cardsDir, reposFile } from '../../cordel/alicerce/config.ts'
import { allCards, listRepos, normalizeId } from '../../cordel/store.ts'
import { memoArquivo, memoChave, memoTempo } from '../../tomada/eco/memo.ts'
import { parseLog } from '../atividade.ts'
import { arquivoDeEventos, eventosDoCard } from '../../euclides/eventos.ts'
import { chamadasDoCard } from '../../euclides/ias-da-sessao.ts'
import { linhaDoTempo } from '../../euclides/linha-do-tempo.ts'
import type { Marco } from '../../euclides/linha-do-tempo.ts'
import type { ChamadaDeIa } from '../../cordel/tipos.ts'

export { passosAtivos, planoDoCard, passosDe } from '../../niemeyer/passos.ts'

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

export const eventosDe = memoArquivo(
  (id) => arquivoDeEventos(normalizeId(id)),
  (id: string) => eventosDoCard(normalizeId(id)),
)

// O ledger de um card pode estar espalhado em varias sessoes (um arquivo por
// arranque do motor), entao nao ha UM arquivo para assinar: cache curto por id.
const chamadasPorCard = new Map<string, () => ChamadaDeIa[]>()
export function chamadasDe(id: string): ChamadaDeIa[] {
  const chave = `${cardsDir()}|${normalizeId(id)}`
  let leitor = chamadasPorCard.get(chave)
  if (!leitor) {
    leitor = memoTempo(() => chamadasDoCard(normalizeId(id)), 500)
    chamadasPorCard.set(chave, leitor)
  }
  return leitor()
}

export function linhaDoTempoDe(id: string): Marco[] {
  return linhaDoTempo({ eventos: eventosDe(id), chamadas: chamadasDe(id), atividades: atividadeDe(id) })
}

export function larguraUtil(): number {
  return Math.max(40, (Number(process.stdout.columns) || 78) - 2)
}
