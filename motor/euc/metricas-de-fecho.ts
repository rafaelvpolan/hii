import type { Card, StepMap, StepMetric } from '../cdl/index.ts'
import { patchCard } from '../cdl/store.ts'
import { updateRunSteps } from './registros.ts'
import { applyFailurePolicy } from '../cic/rpr/politica.ts'
import type { FailurePolicyInput } from '../cic/rpr/politica.ts'

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

export function accumulatedTotals(card: Card, fsteps: StepMap): { cost_usd: string; tokens_total: string } {
  const cost = (parseFloat(card.fm.cost_usd || '0') || 0) + sumStepCost(fsteps)
  const tokens = (Number(card.fm.tokens_total || '0') || 0) + sumStepTokens(fsteps)
  return { cost_usd: cost.toFixed(4), tokens_total: String(tokens) }
}

export function haltForInspection(id: string, card: Card, fsteps: StepMap, message: string): void {
  updateRunSteps(id, fsteps)
  patchCard(id, {
    status: 'HALTED',
    ...accumulatedTotals(card, fsteps),
  }, message)
}

export function applyStepFailurePolicy(id: string, card: Card, fsteps: StepMap, input: Omit<FailurePolicyInput, 'id' | 'extraFields'>): void {
  updateRunSteps(id, fsteps)
  applyFailurePolicy({ id, ...input, extraFields: accumulatedTotals(card, fsteps) })
}
