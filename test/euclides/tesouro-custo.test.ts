import { test, expect } from '../apoio/runner.ts'
import { readReportedCost, COST_UNKNOWN, COST_FREE_LOCAL } from '../../motor/euclides/tesouro/custo.ts'

// Cenarios gerados por IA local (generativo/runs/casos-custo-*.md); 2 das 8
// expectativas estavam erradas e foram corrigidas na revisao (negativo e
// decimal passam direto — o codigo nao filtra sinal nem trunca).

test('custo nao reportado (undefined) e DESCONHECIDO: zero nao medido', () => {
  expect(readReportedCost(undefined)).toEqual({ cost: 0, costMeasured: false })
})

test('NaN e infinitos nao sao custo: caem no desconhecido, nao no medido', () => {
  expect(readReportedCost(NaN)).toEqual(COST_UNKNOWN)
  expect(readReportedCost(Infinity)).toEqual(COST_UNKNOWN)
  expect(readReportedCost(-Infinity)).toEqual(COST_UNKNOWN)
})

test('zero reportado e MEDIDO — semanticamente oposto ao zero desconhecido', () => {
  // Invariante que a suite ja cobra nos adaptadores; aqui fica travado na fonte.
  const r = readReportedCost(0)
  expect(r.cost).toBe(0)
  expect(r.costMeasured).toBe(true)
  expect(r).not.toEqual(COST_UNKNOWN)
  expect(r).toEqual(COST_FREE_LOCAL)
})

test('numero finito passa direto: sem filtro de sinal, sem truncamento', () => {
  // O rascunho generativo chutou -123 como desconhecido e 123.456 truncado;
  // o codigo devolve ambos intactos e medidos.
  expect(readReportedCost(-123)).toEqual({ cost: -123, costMeasured: true })
  expect(readReportedCost(123.456)).toEqual({ cost: 123.456, costMeasured: true })
})
