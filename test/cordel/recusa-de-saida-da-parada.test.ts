import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const CARDS = mkdtempSync(join(tmpdir(), 'hicode-recusa-'))
process.env.HII_CARDS_DIR = CARDS

const { createCard, readCard, patchCard, updateCard, patchCardWith, updateCardPorAcaoHumana, foiRecusada } = await import('../../motor/cordel/store.ts')

afterAll(() => rmSync(CARDS, { recursive: true, force: true }))

function cardParado(status: string): string {
  return createCard({ title: 'parado', status, repo: 'org/repo', cost_usd: '1.0000' }, '## Objetivo\np\n')
}

test('escritor comum tentando tirar card de PAUSED recebe recusa EXPLICITA no retorno — antes patchCard devolvia void e o status sumia em silencio', () => {
  const id = cardParado('PAUSED')
  const r = patchCard(id, { status: 'EXECUTING', cost_usd: '2.5000' }, 'job em voo seguindo')
  expect(foiRecusada(r), 'o retorno tem de dizer que foi recusado').toBe(true)
  if (!foiRecusada(r)) return
  expect(r.motivo).toContain('PAUSED')
  expect(r.motivo).toContain('EXECUTING')
  expect(r.card.status, 'o card gravado continua parado').toBe('PAUSED')
  expect(r.card.cost_usd, 'o que foi medido continua sendo gravado').toBe('2.5000')
  expect(readCard(id)?.fm.status).toBe('PAUSED')
})

test('updateCard e patchCardWith sem a porta devolvem a mesma recusa; escrita SEM status passa inteira', () => {
  const id = cardParado('PAUSED')
  expect(foiRecusada(updateCard(id, { fields: { status: 'URL_OK' } }))).toBe(true)
  expect(foiRecusada(patchCardWith(id, () => ({ status: 'URL_OK' })))).toBe(true)
  const soMetrica = patchCard(id, { tokens_total: '77' })
  expect(foiRecusada(soMetrica)).toBe(false)
  expect(soMetrica !== null && !foiRecusada(soMetrica) ? soMetrica.tokens_total : '').toBe('77')
  expect(readCard(id)?.fm.status).toBe('PAUSED')
})

test('HALTED tem a mesma recusa explicita — as duas sao parada humana', () => {
  const id = cardParado('HALTED')
  expect(foiRecusada(patchCard(id, { status: 'EXECUTING' }, 'x HALTED->EXECUTING job em voo'))).toBe(true)
  expect(readCard(id)?.fm.status).toBe('HALTED')
})

test('escritor autorizado (porta updateCardPorAcaoHumana) sai de PAUSED e recebe o card gravado, nao recusa', () => {
  const id = cardParado('PAUSED')
  const r = updateCardPorAcaoHumana(id, { fields: { status: 'URL_OK' }, log: 'humano liberou' })
  expect(r?.status).toBe('URL_OK')
  expect(readCard(id)?.fm.status).toBe('URL_OK')
})

test('card inexistente continua null — "recusado" e "nao achei" sao respostas distintas', () => {
  const r = patchCard('999', { status: 'EXECUTING' })
  expect(r).toBeNull()
  expect(foiRecusada(r)).toBe(false)
})
