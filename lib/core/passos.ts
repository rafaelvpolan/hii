import { join } from 'node:path'
import { cardsDir } from '../runner/config'
import { findCardFile, readCard } from '../runner/card-store'
import { memoArquivo, memoTempo } from './cache'
import { extractObjetivo } from '../card'
import type { Fields } from '../card'
import { planSteps } from '../runner/analyze'
import { activeSteps } from '../runner/pipeline/config'
import { readRunSteps } from '../runner/runs'
import { passosDoCard } from './progresso'
import type { Passo } from './progresso'
import type { PipelineStep } from '../runner/pipeline/types'

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
