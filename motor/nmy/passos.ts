import { join } from 'node:path'
import { cardsDir } from '../cdl/ali/config.ts'
import { findCardFile, readCard } from '../cdl/store.ts'
import { memoArquivo, memoTempo } from '../tmd/eco/memo.ts'
import { extractObjetivo } from '../cdl/index.ts'
import type { Fields } from '../cdl/index.ts'
import { planSteps } from '../osw/rta/perfil.ts'
import { activeSteps } from './config.ts'
import { readRunSteps } from '../euc/registros.ts'
import { passosDoCard } from '../mir/progresso.ts'
import type { Passo } from '../mir/progresso.ts'
import type { PipelineStep } from './tipos.ts'

export const passosAtivos = memoTempo(() => activeSteps(), 5000)

export const planoDoCard = memoArquivo(
  (id) => join(cardsDir(), findCardFile(id) ?? 'inexistente'),
  (id: string): PipelineStep[] => {
    const card = readCard(id)
    if (!card) return []
    const objetivo = extractObjetivo(card.body) || card.fm.title
    return planSteps(
      { title: card.fm.title, objetivo, risk: card.fm.risk, surface: card.fm.surface, override: card.fm.steps },
      passosAtivos(),
    ).steps
  },
)

export function passosDe(c: Fields): Passo[] {
  const id = String(c.id ?? '')
  const steps = planoDoCard(id)
  if (!steps.length) return []
  return passosDoCard(c, steps, readRunSteps(id))
}
