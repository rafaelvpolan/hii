import type { Card, ClasseDeParada, StepMap, StepMetric } from '../cordel/index.ts'
import { patchCard } from '../cordel/store.ts'
import { updateRunSteps } from './registros.ts'
import { applyFailurePolicy } from '../ciclo/reprise/politica.ts'
import type { FailurePolicyInput } from '../ciclo/reprise/politica.ts'

export function addMetric(fsteps: StepMap, key: string, m: StepMetric): void {
  const p = fsteps[key] ?? { time: 0, cost: 0, tokens: 0 }
  fsteps[key] = {
    time: p.time + m.time,
    cost: p.cost + m.cost,
    tokens: p.tokens + m.tokens,
    costMeasured: p.costMeasured !== false && m.costMeasured !== false,
  }
}

function sumStepCost(fsteps: StepMap): number {
  return Object.values(fsteps).reduce((acc, s) => acc + (Number(s.cost) || 0), 0)
}

function sumStepTokens(fsteps: StepMap): number {
  return Object.values(fsteps).reduce((acc, s) => acc + (Number(s.tokens) || 0), 0)
}

export function sumStepTime(fsteps: StepMap): number {
  return Object.values(fsteps).reduce((acc, s) => acc + (Number(s.time) || 0), 0)
}

export type TotaisDoCard = {
  cost_usd: string
  tokens_total: string
  tempo_s: string
}

export function accumulatedTotals(card: Card, fsteps: StepMap): TotaisDoCard {
  const cost = (parseFloat(card.fm.cost_usd || '0') || 0) + sumStepCost(fsteps)
  const tokens = (Number(card.fm.tokens_total || '0') || 0) + sumStepTokens(fsteps)
  const tempo = (Number(card.fm.tempo_s || '0') || 0) + sumStepTime(fsteps)
  return { cost_usd: cost.toFixed(4), tokens_total: String(tokens), tempo_s: String(tempo) }
}

// `classe` e OBRIGATORIA, e de proposito: este e o caminho de parada mais usado do
// polimento (nove chamadores em quilombo/cartorio/fechar.ts) e era o maior produtor de
// HALT mudo. Parametro opcional deixaria o esquecimento passar no typecheck.
export function haltForInspection(id: string, card: Card, fsteps: StepMap, message: string, resumeStep: string, classe: ClasseDeParada): void {
  updateRunSteps(id, fsteps)
  patchCard(id, {
    status: 'HALTED',
    halt_class: classe,
    retomar_em: 'URL_OK',
    resume_from: resumeStep,
    ...accumulatedTotals(card, fsteps),
  }, message)
}

export function pauseForConfirmation(id: string, card: Card, fsteps: StepMap, message: string, resumeStep: string): void {
  updateRunSteps(id, fsteps)
  patchCard(id, {
    status: 'CONFIRM',
    retomar_em: 'URL_OK',
    resume_from: resumeStep,
    ...accumulatedTotals(card, fsteps),
  }, message)
}

export function applyStepFailurePolicy(id: string, card: Card, fsteps: StepMap, input: Omit<FailurePolicyInput, 'id' | 'extraFields'>): void {
  updateRunSteps(id, fsteps)
  applyFailurePolicy({ id, ...input, extraFields: accumulatedTotals(card, fsteps) })
}
