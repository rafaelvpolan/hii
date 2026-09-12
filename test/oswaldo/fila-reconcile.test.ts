import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const CARDS = mkdtempSync(join(tmpdir(), 'hicode-queue-'))
process.env.HII_CARDS_DIR = CARDS

const { createCard, readCard } = await import('../../motor/cordel/store.ts')
const { reconcileStranded, pending, halteradosDoLote } = await import('../../motor/oswaldo/mutirao/estado-da-fila.ts')

afterAll(() => rmSync(CARDS, { recursive: true, force: true }))

function card(status: string, title = status.toLowerCase()): string {
  return createCard({ title, status, repo: 'org/repo' }, '## Objetivo\nalgo\n')
}

function statusOf(id: string): string {
  return readCard(id)?.fm.status ?? ''
}

test('reconcile: estados de polimento voltam para URL_OK', () => {
  const ids = ['REFINED', 'TESTS_GREEN', 'SEC_CLEARED', 'REVIEWED', 'CLEANED'].map(s => card(s))
  reconcileStranded()
  for (const id of ids) expect(statusOf(id)).toBe('URL_OK')
})

test('reconcile: EXECUTED volta para EXECUTING (nao havia consumidor)', () => {
  const id = card('EXECUTED')
  reconcileStranded()
  expect(statusOf(id)).toBe('EXECUTING')
})

test('reconcile: estados reexecutaveis mantem o status', () => {
  const ids = ['EXECUTING', 'CORRECTING', 'SPECCED'].map(s => card(s))
  const antes = ids.map(statusOf)
  reconcileStranded()
  expect(ids.map(statusOf)).toEqual(antes)
})

test('reconcile: estados terminais e de espera nao sao tocados', () => {
  const intocaveis = ['READY', 'CLARIFY', 'URL', 'URL_OK', 'PR_OPEN', 'MERGED', 'HALTED', 'PAUSED']
  const ids = intocaveis.map(s => card(s))
  reconcileStranded()
  expect(ids.map(statusOf)).toEqual(intocaveis)
})

test('REGRESSAO: WAITING (mesmo sem wait_until) sobrevive a reinicio do daemon intocado — reconcile nao mexe em backoff; quem acorda (inclusive com wait_until ausente, fail-open) e wakeDueWaiting, coberto em waiting-wake.test.ts', () => {
  const id = card('WAITING')
  reconcileStranded()
  expect(statusOf(id)).toBe('WAITING')
})

test('reconcile: registra o motivo no log do card', () => {
  const id = card('REVIEWED')
  reconcileStranded()
  expect(readCard(id)?.body).toContain('recuperado apos reinicio do daemon')
})

test('reconcile e idempotente: rodar duas vezes nao muda mais nada', () => {
  const id = card('CLEANED')
  reconcileStranded()
  const depois = statusOf(id)
  reconcileStranded()
  expect(statusOf(id)).toBe(depois)
})

function ocorrencias(id: string, trecho: string): number {
  return (readCard(id)?.body.match(new RegExp(trecho, 'g')) ?? []).length
}

test('REGRESSAO: reinicio repetido nao duplica a linha de interrompido no card', () => {
  const id = card('EXECUTING')
  reconcileStranded()
  reconcileStranded()
  reconcileStranded()
  expect(ocorrencias(id, 'interrompido por reinicio do daemon')).toBe(1)
})

test('REGRESSAO: card que muda de estado volta a registrar o interrompido', async () => {
  const { patchCard } = await import('../../motor/cordel/store.ts')
  const id = card('EXECUTING')
  reconcileStranded()
  patchCard(id, { status: 'CORRECTING' })
  reconcileStranded()
  expect(ocorrencias(id, 'interrompido por reinicio do daemon')).toBe(2)
})

test('pending: spec vem antes de execute, finish e correct', () => {
  const sp = card('SPECCED')
  const ex = card('EXECUTING')
  const fi = card('URL_OK')
  const co = card('CORRECTING')
  const jobs = pending()
  const pos = (id: string): number => jobs.findIndex(j => j.id === id)
  expect(pos(sp)).toBeGreaterThanOrEqual(0)
  expect(pos(sp)).toBeLessThan(pos(ex))
  expect(pos(ex)).toBeLessThan(pos(fi))
  expect(pos(fi)).toBeLessThan(pos(co))
})

test('pending: mapeia cada status para o job correto', () => {
  const ex = card('EXECUTING')
  const fi = card('URL_OK')
  const co = card('CORRECTING')
  const sp = card('SPECCED')
  const kind = (id: string): string => pending().find(j => j.id === id)?.kind ?? ''
  expect(kind(ex)).toBe('execute')
  expect(kind(fi)).toBe('finish')
  expect(kind(co)).toBe('correct')
  expect(kind(sp)).toBe('spec')
})

test('pending: status sem job nao entra na fila', () => {
  const parado = card('HALTED')
  const esperando = card('URL')
  const ids = pending().map(j => j.id)
  expect(ids).not.toContain(parado)
  expect(ids).not.toContain(esperando)
})

test('reconcile: resume_from nasce do estado gravado — passo ja pago nao repete no finish reiniciado', () => {
  const esperado: Array<[string, string]> = [
    ['REFINED', 'Testes'],
    ['TESTS_GREEN', 'Seguranca'],
    ['SEC_CLEARED', 'Limpeza'],
    ['CLEANED', '__apos_passos__'],
  ]
  for (const [estado, resume] of esperado) {
    const id = card(estado)
    reconcileStranded()
    const fm = readCard(id)?.fm
    expect(fm?.status, `estado ${estado}`).toBe('URL_OK')
    expect(fm?.resume_from, `estado ${estado}`).toBe(resume)
  }
})

test('reconcile: REVIEWED (passo removido do pipeline) volta sem resume_from — o replay decide', () => {
  const id = card('REVIEWED')
  reconcileStranded()
  const fm = readCard(id)?.fm
  expect(fm?.status).toBe('URL_OK')
  expect(String(fm?.resume_from ?? '')).toBe('')
})

test('reconcile: resume_from velho e sobrescrito pelo estado atual do card', () => {
  const id = createCard({ title: 'resume velho', status: 'SEC_CLEARED', repo: 'org/repo', resume_from: 'Testes' }, '## Objetivo\nx\n')
  reconcileStranded()
  expect(readCard(id)?.fm.resume_from).toBe('Limpeza')
})

test('halteradosDoLote: aponta so os cards do lote que terminaram HALTED', () => {
  const ok = card('URL_OK')
  const ruim = card('HALTED')
  card('HALTED')
  expect(halteradosDoLote([ok, ruim])).toEqual([ruim])
  expect(halteradosDoLote([])).toEqual([])
})

test('REGRESSAO: job que volta SEM mudar o status entra em cooldown — o redespacho em 5s virava laco de gasto', async () => {
  const { pending, registrarRetornoSemTransicao, esquecerCooldowns } = await import('../../motor/oswaldo/mutirao/estado-da-fila.ts')
  const id = createCard({ title: 'gira sem sair do lugar', status: 'EXECUTING', repo: 'org/repo' }, '## Objetivo\nx\n')

  expect(pending().some(j => j.id === id), 'antes do cooldown o card e elegivel').toBe(true)

  registrarRetornoSemTransicao(id)
  expect(pending().some(j => j.id === id), 'retorno sem transicao suspende o card pelo intervalo de cooldown').toBe(false)

  registrarRetornoSemTransicao(id, Date.now() - 60_000)
  expect(pending().some(j => j.id === id), 'cooldown vencido devolve o card a fila sozinho').toBe(true)

  esquecerCooldowns()
})

test('cooldown NAO atrasa card que mudou de status — so o retorno suspeito paga o intervalo', async () => {
  const { pending, esquecerCooldowns } = await import('../../motor/oswaldo/mutirao/estado-da-fila.ts')
  esquecerCooldowns()
  const id = createCard({ title: 'progrediu', status: 'URL_OK', repo: 'org/repo' }, '## Objetivo\nx\n')

  expect(pending().some(j => j.id === id)).toBe(true)
})
