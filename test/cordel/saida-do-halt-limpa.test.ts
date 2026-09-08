// Os campos halt_* eram carimbados na ENTRADA de HALTED e nunca limpos na
// saida: o card 005 ficou em URL carregando halt_class terminal por 4 dias, e
// quem chaveia por halt_* contava parada fantasma — no subsistema que existe
// para dizer "o que parou e desde quando" (raio-x, item 21). A limpeza mora no
// mesmo ponto de estrangulamento que o carimbo: updateCard.
import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const CARDS = mkdtempSync(join(tmpdir(), 'hicode-halt-limpa-'))
process.env.HICODE_CARDS_DIR = CARDS

const { createCard, readCard, patchCard, updateCardPorAcaoHumana } = await import('../../motor/cordel/store.ts')

afterAll(() => rmSync(CARDS, { recursive: true, force: true }))

function cardParado(): string {
  return createCard({
    title: 'parado', status: 'HALTED', repo: 'org/repo',
    halt_class: 'terminal', halt_at: '2026-09-01T00:00:00Z', halt_reason: 'algo quebrou', halt_provider: 'claude',
  }, '## Objetivo\np\n')
}

test('sair de HALTED limpa halt_class/at/reason/provider — parada superada nao assombra o leitor', () => {
  const id = cardParado()
  updateCardPorAcaoHumana(id, { fields: { status: 'URL_OK' }, log: 'humano retomou' })
  const fm = readCard(id)?.fm
  expect(fm?.status).toBe('URL_OK')
  expect(String(fm?.halt_class ?? '')).toBe('')
  expect(String(fm?.halt_at ?? '')).toBe('')
  expect(String(fm?.halt_reason ?? '')).toBe('')
  expect(String(fm?.halt_provider ?? '')).toBe('')
})

test('parada NOVA depois da retomada carimba de novo — a limpeza nao vira amnesia', () => {
  const id = cardParado()
  updateCardPorAcaoHumana(id, { fields: { status: 'EXECUTING' }, log: 'humano retomou' })
  patchCard(id, { status: 'HALTED', halt_class: 'orcamento' }, 'EXECUTING->HALTED estourou o teto')
  const fm = readCard(id)?.fm
  expect(fm?.halt_class).toBe('orcamento')
  expect(String(fm?.halt_at ?? '')).not.toBe('')
})
