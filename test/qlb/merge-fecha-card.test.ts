import { test, expect, afterAll } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-merge-fecha-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(join(process.env.HICODE_CARDS_DIR, 'runs'), { recursive: true })
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const M = await import('../../motor/qlb/ctr/merge.ts')
const { anexarEvento, eventosDoCard, cardFechado } = await import('../../motor/euc/eventos.ts')
const C = await import('../../motor/csd/fre/candidatos.ts')
const { faseInterrompida } = await import('../../motor/euc/recuperar.ts')

test('ao mergear, o card e FECHADO no diario — sem isso a retomada varre card antigo para sempre', async () => {
  anexarEvento({ card: 'mrg-1', evento: 'fase_inicio', fase: 'seguranca' })
  expect(cardFechado('mrg-1')).toBe(false)
  await M.aoMergear('mrg-1', join(BASE, 'alvo-1'), 'laravel')
  expect(cardFechado('mrg-1'), 'card_fechado existia como tipo de evento e ninguem escrevia').toBe(true)
})

test('a retomada para de enxergar o card depois de fechado', async () => {
  anexarEvento({ card: 'mrg-2', evento: 'fase_inicio', fase: 'testes' })
  expect(faseInterrompida('mrg-2')).not.toBeNull()
  await M.aoMergear('mrg-2', join(BASE, 'alvo-2'), 'laravel')
  expect(cardFechado('mrg-2')).toBe(true)
})

test('ao mergear, o aprendiz roda e registra candidato do que o card sofreu', async () => {
  const alvo = join(BASE, 'alvo-3')
  anexarEvento({ card: 'mrg-3', evento: 'gate_verdict', fase: 'seguranca', detalhe: 'reprovou: PaymentController sem teste de idempotencia' })
  await M.aoMergear('mrg-3', alvo, 'laravel')
  const cs = C.candidatos(alvo)
  expect(cs.length).toBe(1)
  expect(cs[0]?.ocorrencias[0]?.card).toBe('mrg-3')
})

test('o aprendiz roda ANTES do fechamento — fechar primeiro esconderia o diario dele', async () => {
  const alvo = join(BASE, 'alvo-4')
  anexarEvento({ card: 'mrg-4', evento: 'gate_verdict', fase: 'build', detalhe: 'falhou: composer sem autoload' })
  await M.aoMergear('mrg-4', alvo, 'laravel')
  const eventos = eventosDoCard('mrg-4')
  const iAprendiz = eventos.findIndex(e => e.evento === 'efeito_registrado' && e.fase === 'fre')
  const iFechado = eventos.findIndex(e => e.evento === 'card_fechado')
  expect(iAprendiz).toBeGreaterThanOrEqual(0)
  expect(iAprendiz).toBeLessThan(iFechado)
})

test('mergear duas vezes nao duplica candidato nem fechamento', async () => {
  const alvo = join(BASE, 'alvo-5')
  anexarEvento({ card: 'mrg-5', evento: 'gate_verdict', fase: 'seguranca', detalhe: 'reprovou: x sem y' })
  await M.aoMergear('mrg-5', alvo, 'laravel')
  await M.aoMergear('mrg-5', alvo, 'laravel')
  expect(C.candidatos(alvo)[0]?.ocorrencias.length).toBe(1)
  expect(eventosDoCard('mrg-5').filter(e => e.evento === 'card_fechado').length).toBe(1)
})

test('INVARIANTE checkMerged chama aoMergear no ramo do merge', async () => {
  const fonte = await Bun.file('motor/qlb/ctr/merge.ts').text()
  expect(fonte).toContain('aoMergear(')
  const iMerged = fonte.indexOf("pr.state === 'MERGED'")
  expect(fonte.indexOf('aoMergear(', iMerged)).toBeGreaterThan(iMerged)
})
