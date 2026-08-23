import { test, expect } from 'bun:test'
import { STATUSES } from '../motor/cdl/tipos'
import { phaseLabel } from '../motor/mir/render/phases'

test('REGRESSAO nenhum status vaza cru para o campo fase do painel', () => {
  const crus = STATUSES.filter(s => phaseLabel(s) === s)
  expect(crus).toEqual([])
})

test('os status que esperam humano tem rotulo legivel, nao a constante', () => {
  expect(phaseLabel('CLARIFY')).toBe('Pergunta')
  expect(phaseLabel('HALTED')).toBe('Parado')
  expect(phaseLabel('PAUSED')).toBe('Pausado')
  expect(phaseLabel('WAITING')).toBe('Esperando')
})

test('status desconhecido continua devolvendo ele mesmo, sem inventar rotulo', () => {
  expect(phaseLabel('COISA_NOVA')).toBe('COISA_NOVA')
})
