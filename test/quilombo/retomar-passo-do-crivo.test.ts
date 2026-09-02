// REGRESSAO do card #006 ("resolva o conflito ... /pull/25"), que rodou 3 vezes o
// pipeline inteiro e nunca convergiu.
//
// `haltForInspection` gravava so `retomar_em: 'URL_OK'` e prometia num comentario
// que "os passos ja concluidos sao pulados por `resume_from`" — campo que ele nunca
// escrevia. Quem parava no crivo (fechar.ts, "o crivo reprovou apos N reajuste(s)")
// voltava do PRIMEIRO passo. E os passos EDITAM codigo: rufus e testudo rodavam de
// novo sobre trabalho ja aprovado, geravam diff novo, o crivo achava defeito novo, e
// o card divergia em vez de fechar — $7.16 e tres passagens completas no #006.
//
// So `applyStepFailurePolicy` (falha de provedor) gravava o campo, entao a metade
// mais comum das paradas — o crivo reprovando — nunca retomava direito.
//
// Os dois primeiros testes cobrem as duas pontas: quem ESCREVE o ponto de retomada e
// quem o CONSOME. Um sem o outro passa verde com o defeito vivo.
import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-retomar-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(process.env.HICODE_CARDS_DIR, { recursive: true })

afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const { createCard, readCard } = await import('../../motor/cordel/store.ts')
const { haltForInspection } = await import('../../motor/euclides/metricas-de-fecho.ts')
const { resumeStart, RESUME_POST_STEPS } = await import('../../motor/quilombo/cartorio/retomar.ts')
const { activeSteps } = await import('../../motor/niemeyer/config.ts')

const SEM_METRICA = {}

test('REGRESSAO crivo reprova no meio do pipeline: o card grava ONDE retomar', () => {
  const id = createCard({
    title: 'resolve conflito',
    status: 'TESTS_GREEN',
    repo: 'org/repo',
    surface: 'none',
    cost_usd: '7.1637',
    tokens_total: '552907',
  }, '## Objetivo\nresolver o conflito\n')

  const card = readCard(id)
  expect(card).not.toBe(null)
  haltForInspection(id, card!, SEM_METRICA, 'Seguranca->HALTED o crivo reprovou apos 2 reajuste(s)', 'Seguranca', 'escopo')

  const parado = readCard(id)
  expect(parado?.fm.status).toBe('HALTED')
  expect(parado?.fm.halt_class, 'HALT sem classe deixa /health sem saber se foi cota, orcamento ou exigencia nao cumprida').toBe('escopo')
  expect(parado?.fm.retomar_em).toBe('URL_OK')
  expect(parado?.fm.resume_from, 'sem este campo a retomada refaz Arquitetura e Testes ja aprovados').toBe('Seguranca')
})

test('REGRESSAO o ponto gravado faz a retomada PULAR os passos ja aprovados', () => {
  const steps = activeSteps()
  expect(steps.map(s => s.label)).toEqual(['Arquitetura', 'Testes', 'Seguranca', 'Limpeza'])

  const idx = resumeStart(steps, steps, 'Seguranca', 'nao-usado', 'padrao')

  expect(idx, 'retomar de Seguranca tem de comecar no indice 2').toBe(2)
  expect(steps.slice(idx).map(s => s.label)).toEqual(['Seguranca', 'Limpeza'])
})

test('sem ponto gravado a retomada roda tudo de novo — o comportamento que causou o laco', () => {
  const steps = activeSteps()
  expect(resumeStart(steps, steps, '', 'nao-usado', 'padrao')).toBe(0)
})

test('parada DEPOIS dos passos nao repete nenhum deles', () => {
  const steps = activeSteps()
  const idx = resumeStart(steps, steps, RESUME_POST_STEPS, 'nao-usado', 'padrao')
  expect(idx).toBe(steps.length)
  expect(steps.slice(idx)).toEqual([])
})

test('parada num passo que este perfil nao roda cai no passo aplicavel seguinte', () => {
  const todos = activeSteps()
  const enxuto = todos.filter(s => s.label === 'Limpeza')

  const idx = resumeStart(enxuto, todos, 'Testes', 'nao-usado', 'enxuto')

  expect(enxuto.slice(idx).map(s => s.label)).toEqual(['Limpeza'])
})
