import { join } from 'node:path'
import { cardsDir } from '../cdl/ali/config'
import { findCardFile, readCard } from '../cdl/store'
import { memoArquivo, memoTempo } from '../tmd/eco/memo'
import { extractObjetivo } from '../cdl'
import type { Fields } from '../cdl'
import { planSteps } from '../osw/rta/perfil'
import { activeSteps } from './config'
import { readRunSteps } from '../euc/registros'
import { passosDoCard } from '../../lib/core/progresso'
import type { Passo } from '../../lib/core/progresso'
import type { PipelineStep } from './tipos'

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
