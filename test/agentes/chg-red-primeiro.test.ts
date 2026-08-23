import { test, expect, afterAll } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-chg-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(join(process.env.HICODE_CARDS_DIR, 'runs'), { recursive: true })
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const { exigirRedAntesDoGreen, registrarRed, evidenciaDeRed, FASE_RED } = await import('../../motor/agentes/chg/red-primeiro')

test('perfil completo sem RED no diario reprova, dizendo o porque', () => {
  const r = exigirRedAntesDoGreen('chg-1', 'completo')
  expect(r.exigido).toBe(true)
  expect(r.satisfeito).toBe(false)
  expect(r.motivo).toContain('FALHOU antes de passar')
})

test('com RED registrado, o perfil completo passa e o motivo cita quando', () => {
  registrarRed('chg-2', 'bun test reprovou antes do reparo')
  const r = exigirRedAntesDoGreen('chg-2', 'completo')
  expect(r.satisfeito).toBe(true)
  expect(r.motivo).toContain('reprovou antes do reparo')
  expect(evidenciaDeRed('chg-2').temRed).toBe(true)
})

test('so o perfil completo exige — nos outros o custo nao paga', () => {
  for (const p of ['padrao', 'enxuto', 'deps', 'externo'] as const) {
    const r = exigirRedAntesDoGreen('chg-3', p)
    expect(r.exigido, `${p} nao deveria exigir RED`).toBe(false)
    expect(r.satisfeito).toBe(true)
  }
})

test('o RED e um evento do diario, na fase propria — nao um campo que o modelo escreve', async () => {
  const { eventosDoCard } = await import('../../motor/euc/eventos')
  registrarRed('chg-4', 'detalhe')
  const ev = eventosDoCard('chg-4').filter(e => e.fase === FASE_RED)
  expect(ev.length).toBe(1)
  expect(ev[0]?.evento).toBe('gate_verdict')
})

test('INVARIANTE o portao de teste registra o RED quando a primeira rodada reprova', async () => {
  const fonte = await Bun.file('motor/cic/crv/portoes-de-fecho.ts').text()
  expect(fonte).toContain('registrarRed(o.id')
  expect(fonte, 'so o portao de TESTE produz RED; o de build nao').toContain("portao.id === 'testes'")
})

test('INVARIANTE o fechamento consulta o CHG antes de rodar o gate de teste', async () => {
  const fonte = await Bun.file('motor/qlb/ctr/fechar.ts').text()
  expect(fonte).toContain('exigirRedAntesDoGreen(id, plan.profile)')
  const antes = fonte.indexOf('exigirRedAntesDoGreen') < fonte.indexOf('await testGate(')
  expect(antes, 'consultar depois do gate nao serviria de nada').toBe(true)
})

test('a exigencia e registrada no card mesmo quando nao barra — quem passou sem provar fica visivel', async () => {
  const fonte = await Bun.file('motor/qlb/ctr/fechar.ts').text()
  expect(fonte).toContain('red_antes_do_green')
  expect(fonte, 'barrar so quando o operador ligar').toContain('rigorEstrito()')
})
