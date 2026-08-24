import { test, expect, afterAll } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-chg-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(join(process.env.HICODE_CARDS_DIR, 'runs'), { recursive: true })
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const { exigirRedAntesDoGreen, registrarRed, evidenciaDeRed, FASE_RED } = await import('../../motor/agentes/chg/red-primeiro.ts')

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
  const { eventosDoCard } = await import('../../motor/euc/eventos.ts')
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

// Este teste afirmava o CONTRARIO, e com a justificativa invertida ("consultar
// depois do gate nao serviria de nada"). Era ele que mantinha o defeito no lugar: o
// unico produtor da evidencia e registrarRed, que roda DENTRO de testGate
// (motor/cic/crv/portoes-de-fecho.ts:97), entao consultar antes garantia diario
// vazio. red.satisfeito era constante false — com rigor estrito todo card completo
// fazia HALT, e desligado gravava 'nao' mesmo com TDD de verdade.
//
// A ordem no texto-fonte e sentinela, nao prova: quem prova o comportamento sao os
// testes acima, que exercitam registrarRed -> exigirRedAntesDoGreen nessa ordem —
// agora a mesma ordem da producao.
test('INVARIANTE o fechamento consulta o CHG DEPOIS do gate que produz a evidencia', async () => {
  const fonte = await Bun.file('motor/qlb/ctr/fechar.ts').text()
  const iChg = fonte.indexOf('exigirRedAntesDoGreen(id, plan.profile)')
  const iGate = fonte.indexOf('await testGate(')
  // Guarda contra o -1: sem isto, apagar qualquer um dos dois faria a comparacao
  // passar por acidente — o defeito que a versao anterior tinha.
  expect(iChg, 'a consulta ao CHG sumiu de fechar.ts').toBeGreaterThan(-1)
  expect(iGate, 'a chamada a testGate sumiu de fechar.ts').toBeGreaterThan(-1)
  expect(iChg > iGate, 'registrarRed vive dentro de testGate: consultar antes le sempre o diario vazio').toBe(true)
})

test('a exigencia e registrada no card mesmo quando nao barra — quem passou sem provar fica visivel', async () => {
  const fonte = await Bun.file('motor/qlb/ctr/fechar.ts').text()
  expect(fonte).toContain('red_antes_do_green')
  expect(fonte, 'barrar so quando o operador ligar').toContain('rigorEstrito()')
})

// LIMITE CONHECIDO, documentado aqui para nao virar surpresa quando
// HICODE_RIGOR_ESTRITO=1 for ligado. O unico produtor de evidencia de RED e
// `registrarRed`, chamado quando a PRIMEIRA rodada do comando de teste REPROVA no
// fecho. Consequencia: card `completo` que chega com a suite VERDE nunca tem RED,
// e card que chega quebrado e e reparado passa — o incentivo fica invertido.
//
// Nao foi "consertado" mexendo no gate porque isso mudaria a semantica do item 5
// (ver PENDENCIAS.md, "DECISAO PENDENTE — a evidencia de RED"). O teste existe para
// o comportamento ficar preso e visivel enquanto a decisao nao vem.
test('LIMITE card completo com suite JA VERDE nao tem evidencia de RED', () => {
  const r = exigirRedAntesDoGreen('chg-verde-de-nascenca', 'completo')
  expect(r.exigido).toBe(true)
  expect(r.satisfeito, 'sem RED registrado a exigencia NAO e satisfeita — e com rigor estrito isso e HALT').toBe(false)
  expect(r.motivo).toContain('nao tem evento de RED')
})

test('LIMITE card que chegou QUEBRADO e foi reparado satisfaz a exigencia', () => {
  registrarRed('chg-reparado', 'npm test reprovou antes do reparo')
  const r = exigirRedAntesDoGreen('chg-reparado', 'completo')
  expect(r.satisfeito, 'o caminho que passa hoje e o do card que chegou vermelho').toBe(true)
})
