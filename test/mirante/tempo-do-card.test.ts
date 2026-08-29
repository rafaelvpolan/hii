// Pedido em uso: "quero que coloque tambem a contabilidade do tempo de cada card".
// O card contabilizava US$ e tokens e nao contabilizava tempo — a reclamacao era
// "acho que demorou" e nao havia numero para responder.
//
// Duas grandezas, e o ponto do recurso e nao misturar as duas: no card 006 o motor
// trabalhou ~33min, mas do `created` ao PR passaram ~52min. A diferenca era espera
// humana. Um numero unico apontaria o dedo para o lado errado.
import { test, expect } from '../apoio/runner.ts'
import { relatoDeTempo, tempoDeMotorS, tempoDeParedeS, esperaHumanaS } from '../../motor/mirante/render/tempo-do-card.ts'
import { accumulatedTotals } from '../../motor/euclides/metricas-de-fecho.ts'
import type { Card, Fields, StepMap } from '../../motor/cordel/index.ts'

const CRIADO = '2026-08-25T04:19:09Z'
const FECHADO = '2026-08-25T05:11:36Z'
const AGORA = Date.parse('2026-08-25T06:00:00Z')

function card(fm: Fields): Card {
  return { fm, order: Object.keys(fm), body: '## Objetivo\nx\n', file: 'cards/900-x.md' }
}

test('REGRESSAO o tempo dos passos entra no card, do mesmo jeito que o custo', () => {
  const passos: StepMap = {
    Arquitetura: { time: 124, cost: 0.7654, tokens: 34780 },
    Testes: { time: 206, cost: 1.4656, tokens: 66906 },
  }
  const totais = accumulatedTotals(card({ cost_usd: '1.0000', tokens_total: '100', tempo_s: '239' }), passos)

  expect(totais.tempo_s, 'sem isto o card nunca soube quanto tempo gastou').toBe('569')
  expect(totais.cost_usd).toBe('3.2310')
})

test('tempo acumula entre execucoes — retomada nao zera o relogio', () => {
  const primeira = accumulatedTotals(card({ tempo_s: '' }), { Testes: { time: 206, cost: 0, tokens: 0 } })
  expect(primeira.tempo_s).toBe('206')

  const segunda = accumulatedTotals(card({ tempo_s: primeira.tempo_s }), { Seguranca: { time: 54, cost: 0, tokens: 0 } })
  expect(segunda.tempo_s).toBe('260')
})

test('card parado usa o updated; card andando usa agora', () => {
  const parado = { created: CRIADO, updated: FECHADO, status: 'PR_OPEN', tempo_s: '1992' }
  expect(tempoDeParedeS(parado, AGORA)).toBe(3147)

  const andando = { created: CRIADO, updated: FECHADO, status: 'TESTS_GREEN', tempo_s: '1992' }
  expect(tempoDeParedeS(andando, AGORA), 'card em voo tem parede que ainda cresce').toBe(6051)
})

test('a espera humana e a parede menos o motor — e e ela que explica a demora', () => {
  const fm = { created: CRIADO, updated: FECHADO, status: 'PR_OPEN', tempo_s: '1992' }
  expect(tempoDeMotorS(fm)).toBe(1992)
  expect(esperaHumanaS(fm, AGORA)).toBe(1155)
  expect(relatoDeTempo(fm, AGORA)).toBe('motor 33m12s · parede 52m27s (19m15s esperando voce)')
})

test('sem espera nenhuma o relato nao inventa a cauda', () => {
  const fm = { created: CRIADO, updated: CRIADO, status: 'PR_OPEN', tempo_s: '120' }
  expect(relatoDeTempo(fm, AGORA)).toBe('motor 2m00s')
})

test('card sem tempo nenhum nao imprime linha — campo vazio treina o olho a ignorar a tela', () => {
  expect(relatoDeTempo({}, AGORA)).toBe('')
})

test('created ilegivel nao virou NaN na tela', () => {
  expect(tempoDeParedeS({ created: 'ontem', status: 'PR_OPEN' }, AGORA)).toBe(0)
  expect(relatoDeTempo({ created: 'ontem', status: 'PR_OPEN', tempo_s: '60' }, AGORA)).toBe('motor 1m00s')
})
