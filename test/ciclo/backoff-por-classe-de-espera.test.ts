import { beforeEach, test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// O defeito que este arquivo fecha esta no card 002: `13:20:03 EXECUTING->WAITING
// (tentativa 1/8)` por timeout de 900 s do CLI e, trinta segundos depois,
// `13:20:33 WAITING->EXECUTING`. O backoff era funcao SO do numero da tentativa,
// entao um provedor que consumiu quinze minutos sem responder era retentado no
// mesmo degrau de um reset de conexao — e cada retentativa dessas custa uma chamada
// de IA paga.
//
// A classe de falha nao servia para separar os dois: `quota` e `terminal` vao direto
// a HALT, entao TUDO o que chega a WAITING e `transient`. Quem separa e ClasseDeEspera.

const CARDS = mkdtempSync(join(tmpdir(), 'hicode-backoff-classe-'))
process.env.HICODE_CARDS_DIR = CARDS

const { createCard, readCard } = await import('../../motor/cordel/store.ts')
const { applyFailurePolicy, backoffMsFor, CLASSE_DE_ESPERA_PADRAO } = await import('../../motor/ciclo/reprise/politica.ts')
const { classeDeEsperaDe, classifyFailure } = await import('../../motor/ciclo/reprise/classe-de-falha.ts')
const { wakeDueWaiting } = await import('../../motor/ciclo/reprise/espera.ts')
const { RUN_TIMEOUT_MS } = await import('../../motor/cordel/alicerce/config.ts')

beforeEach(() => {
  process.env.HICODE_WAITING_MAX_ATTEMPTS = '8'
  delete process.env.HICODE_ESPERA_PISO_TIMEOUT_MS
  delete process.env.HICODE_ESPERA_PISO_TAXA_MS
})

afterAll(() => rmSync(CARDS, { recursive: true, force: true }))

function card(): string {
  return createCard({ title: 'algo', status: 'EXECUTING', repo: 'org/repo' }, '## Objetivo\nalgo\n')
}

const SEM_SINAIS = { sinaisDeFalha: () => ({ terminal: [], quota: [], transient: [] }) }

// `isoAt` (motor/cordel/util.ts:5-7) tira os milissegundos do carimbo, entao o
// `wait_until` gravado no card e o instante real ARREDONDADO PARA BAIXO em ate 999 ms.
// Comparar contra o piso cru faz o teste reprovar em ~93% das execucoes por causa do
// formato, nao do backoff. A folga e de um segundo, e e do formato.
const FOLGA_DO_CARIMBO_MS = 1000

// ---- o piso, e a garantia de que a mudanca e ADITIVA ----

test('REGRESSAO sem classe o backoff e exatamente o de antes — a escada nua', () => {
  expect(backoffMsFor(1)).toBe(30_000)
  expect(backoffMsFor(2)).toBe(60_000)
  expect(backoffMsFor(5)).toBe(600_000)
  expect(backoffMsFor(50)).toBe(600_000)
  expect(CLASSE_DE_ESPERA_PADRAO).toBe('rede')
  expect(backoffMsFor(1, 'rede')).toBe(backoffMsFor(1))
})

test('timeout nao e retentado antes de ter esperado o que o timeout consumiu', () => {
  expect(backoffMsFor(1, 'timeout')).toBe(RUN_TIMEOUT_MS)
  expect(backoffMsFor(1, 'timeout')).toBeGreaterThan(backoffMsFor(1, 'rede'))
})

test('429 espera pelo menos a janela de taxa, e nao os 30s do primeiro degrau', () => {
  expect(backoffMsFor(1, 'taxa')).toBe(60_000)
})

test('o piso LEVANTA o degrau, nunca o abaixa: escada acima do piso continua mandando', () => {
  expect(backoffMsFor(5, 'taxa')).toBe(600_000)
  expect(backoffMsFor(5, 'rede')).toBe(600_000)
})

test('o piso e do operador: variavel de ambiente manda, e o de timeout acompanha o teto de execucao', () => {
  process.env.HICODE_ESPERA_PISO_TIMEOUT_MS = '5000'
  expect(backoffMsFor(1, 'timeout')).toBe(30_000)
  process.env.HICODE_ESPERA_PISO_TAXA_MS = '900000'
  expect(backoffMsFor(1, 'taxa')).toBe(900_000)
})

// ---- quem decide a classe ----

test('timeout tem precedencia: o sinal e estrutural, nao textual', () => {
  expect(classeDeEsperaDe({ timedOut: true })).toBe('timeout')
  expect(classeDeEsperaDe({ timedOut: true, texto: 'HTTP 429 too many requests' })).toBe('timeout')
})

test('429 e reconhecido pelo texto do provedor, em qualquer das formas que ele usa', () => {
  expect(classeDeEsperaDe({ texto: 'HTTP/1.1 429 Too Many Requests' })).toBe('taxa')
  expect(classeDeEsperaDe({ texto: 'rate limit exceeded, retry later' })).toBe('taxa')
  expect(classeDeEsperaDe({ texto: 'limite de taxa (429)' })).toBe('taxa')
})

test('o resto do transitorio fica na escada: sem janela declarada, sem piso', () => {
  expect(classeDeEsperaDe({ texto: 'ECONNRESET socket hang up' })).toBe('rede')
  expect(classeDeEsperaDe({ texto: '503 service unavailable' })).toBe('rede')
  expect(classeDeEsperaDe({})).toBe('rede')
})

test('classifyFailure entrega a classe de espera junto da classe de falha', () => {
  const porTimeout = classifyFailure(SEM_SINAIS, { timedOut: true, detail: '', text: '' })
  expect(porTimeout.failureClass).toBe('transient')
  expect(porTimeout.classeDeEspera).toBe('timeout')

  const porTaxa = classifyFailure(SEM_SINAIS, { timedOut: false, detail: 'HTTP 429', text: '' })
  expect(porTaxa.failureClass).toBe('transient')
  expect(porTaxa.classeDeEspera).toBe('taxa')

  const porRede = classifyFailure(SEM_SINAIS, { timedOut: false, detail: 'ECONNRESET', text: '' })
  expect(porRede.classeDeEspera).toBe('rede')
})

// ---- o campo no card, que e o que atravessa processos ----

test('a politica GRAVA wait_class no card e a espera respeita o piso da classe', () => {
  const id = card()
  const antes = Date.now()
  applyFailurePolicy({
    id, fromStatus: 'EXECUTING', resumeStatus: 'EXECUTING', provider: 'claude',
    failureClass: 'transient', failureReason: 'timeout — provedor nao respondeu a tempo',
    waitClass: 'timeout', technicalDetail: 'apos 900s',
  })
  const c = readCard(id)
  expect(c?.fm.status).toBe('WAITING')
  expect(c?.fm.wait_class).toBe('timeout')
  expect(Date.parse(c?.fm.wait_until ?? '') - antes).toBeGreaterThanOrEqual(RUN_TIMEOUT_MS - FOLGA_DO_CARIMBO_MS)
  expect(c?.body).toContain('[espera: timeout]')
})

test('quem nao informa classe continua caindo na escada de antes', () => {
  const id = card()
  const antes = Date.now()
  applyFailurePolicy({
    id, fromStatus: 'EXECUTING', resumeStatus: 'EXECUTING', provider: 'claude',
    failureClass: 'transient', failureReason: 'rede indisponivel', technicalDetail: 'ECONNRESET',
  })
  const c = readCard(id)
  expect(c?.fm.wait_class).toBe('rede')
  expect(Date.parse(c?.fm.wait_until ?? '') - antes).toBeLessThan(RUN_TIMEOUT_MS)
})

test('o HALT limpa wait_class junto dos outros campos de espera — classe velha nao sobrevive ao card', () => {
  const id = card()
  applyFailurePolicy({
    id, fromStatus: 'EXECUTING', resumeStatus: 'EXECUTING', provider: 'claude',
    failureClass: 'transient', failureReason: 'x', waitClass: 'timeout', technicalDetail: 'x',
  })
  expect(readCard(id)?.fm.wait_class).toBe('timeout')
  applyFailurePolicy({
    id, fromStatus: 'EXECUTING', resumeStatus: 'EXECUTING', provider: 'claude',
    failureClass: 'terminal', failureReason: 'credencial invalida', technicalDetail: '401',
  })
  const c = readCard(id)
  expect(c?.fm.status).toBe('HALTED')
  expect(c?.fm.wait_class).toBe('')
})

// ---- a segunda espera, que roda em OUTRO processo e so tem o frontmatter ----

test('o reagendamento le wait_class do card: a escala sobrevive a troca de processo', async () => {
  const id = createCard({
    title: 'algo', status: 'WAITING', repo: 'org/repo',
    wait_until: new Date(Date.now() - 1000).toISOString(),
    wait_resume_status: 'EXECUTING', wait_provider: 'claude',
    wait_attempts: '1', wait_reason: 'timeout', wait_class: 'timeout',
  }, '## Objetivo\nalgo\n')
  const antes = Date.now()
  await wakeDueWaiting(() => Promise.resolve(false))
  const c = readCard(id)
  expect(c?.fm.status).toBe('WAITING')
  expect(c?.fm.wait_attempts).toBe('2')
  expect(Date.parse(c?.fm.wait_until ?? '') - antes).toBeGreaterThanOrEqual(RUN_TIMEOUT_MS - FOLGA_DO_CARIMBO_MS)
})

test('card gravado ANTES de wait_class existir reagenda pela escada nua, sem quebrar', async () => {
  const id = createCard({
    title: 'algo', status: 'WAITING', repo: 'org/repo',
    wait_until: new Date(Date.now() - 1000).toISOString(),
    wait_resume_status: 'EXECUTING', wait_provider: 'claude',
    wait_attempts: '1', wait_reason: 'rede indisponivel',
  }, '## Objetivo\nalgo\n')
  const antes = Date.now()
  await wakeDueWaiting(() => Promise.resolve(false))
  const c = readCard(id)
  expect(c?.fm.wait_attempts).toBe('2')
  expect(Date.parse(c?.fm.wait_until ?? '') - antes).toBeLessThan(RUN_TIMEOUT_MS)
})
