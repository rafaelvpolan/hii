import { test, expect, afterAll, afterEach } from '../apoio/runner.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { DecisaoDeRota } from '../../motor/tomada/rota.ts'

const CARDS = mkdtempSync(join(tmpdir(), 'hii-troca-cota-'))
process.env.HII_CARDS_DIR = CARDS

const { createCard, readCard } = await import('../../motor/cordel/store.ts')
const { applyFailurePolicy } = await import('../../motor/ciclo/reprise/politica.ts')
const { pendencia, responder } = await import('../../motor/mirante/responder.ts')
const { modoDeTrocaPorCota, comPoliticaDeExecucaoFixa } = await import('../../motor/cordel/alicerce/config.ts')

afterEach(() => { delete process.env.HII_QUOTA_FALLBACK })
afterAll(() => rmSync(CARDS, { recursive: true, force: true }))

const paraOllama = (): DecisaoDeRota => ({ acao: 'trocar', para: 'ollama', motivo: 'roda local e esta apto' })

function cotaEsgotada(): string {
  const id = createCard({ title: 'tarefa', status: 'EXECUTING', repo: 'org/repo' }, '## Objetivo\nalgo\n')
  applyFailurePolicy({
    id, fromStatus: 'EXECUTING', resumeStatus: 'EXECUTING', provider: 'claude', papel: 'implement',
    failureClass: 'quota', failureReason: 'limite da janela 5h atingido', technicalDetail: '429', rota: paraOllama,
  })
  return id
}

test('o padrao e perguntar: sem env, a troca nao e automatica', () => {
  expect(modoDeTrocaPorCota()).toBe('perguntar')
})

test('politica congelada antes do modo novo continua automatica se a antiga era automatica', async () => {
  const modo = await comPoliticaDeExecucaoFixa(() => Promise.resolve(modoDeTrocaPorCota()),
    { versao: 1, localidade: 'qualquer', fallbackRemoto: true, fallbackCota: true })
  expect(modo).toBe('automatica')
})

test('cota esgotada para a tarefa com a IA recomendada, sem trocar sozinha', () => {
  const fm = readCard(cotaEsgotada())?.fm
  expect(fm?.status).toBe('HALTED')
  expect(fm?.halt_class).toBe('quota')
  expect(fm?.troca_recomendada).toBe('ollama')
  expect(fm?.provider_override_implement ?? '').toBe('')
})

test('a recomendacao aparece como pergunta com as duas opcoes', () => {
  const p = pendencia(cotaEsgotada())
  expect(p?.origem).toBe('cota')
  expect(p?.atual.options).toEqual(['Trocar para ollama e retomar', 'Nao trocar; aguardar a cota renovar'])
  expect(p?.atual.recommended).toBe('Trocar para ollama e retomar')
  expect(p?.atual.q).toContain('claude')
})

test('aceitar a troca retoma a tarefa no provedor recomendado', () => {
  const id = cotaEsgotada()
  const r = responder(id, '1')
  const fm = readCard(id)?.fm
  expect(r.ok).toBe(true)
  expect(r.retomou).toBe(true)
  expect(fm?.status).toBe('EXECUTING')
  expect(fm?.provider_override_implement).toBe('ollama')
  expect(fm?.rota_tentados).toContain('claude')
  expect(fm?.rota_contexto).toContain('ollama')
  expect(pendencia(id)).toBeNull()
})

test('recusar a troca mantem a tarefa parada e encerra a pergunta', () => {
  const id = cotaEsgotada()
  const r = responder(id, '2')
  const fm = readCard(id)?.fm
  expect(r.ok).toBe(true)
  expect(r.retomou).toBe(false)
  expect(fm?.status).toBe('HALTED')
  expect(fm?.troca_decidida).toBe('aguardar')
  expect(fm?.provider_override_implement ?? '').toBe('')
  expect(pendencia(id)).toBeNull()
})

test('HII_QUOTA_FALLBACK=on preserva a troca automatica de antes', () => {
  process.env.HII_QUOTA_FALLBACK = 'on'
  const fm = readCard(cotaEsgotada())?.fm
  expect(fm?.status).toBe('EXECUTING')
  expect(fm?.provider_override_implement).toBe('ollama')
  expect(fm?.troca_recomendada ?? '').toBe('')
})

test('HII_QUOTA_FALLBACK=off para sem recomendar', () => {
  process.env.HII_QUOTA_FALLBACK = 'off'
  const id = cotaEsgotada()
  const fm = readCard(id)?.fm
  expect(fm?.status).toBe('HALTED')
  expect(fm?.troca_recomendada ?? '').toBe('')
  expect(pendencia(id)).toBeNull()
})

test('sem candidato apto, para como antes e nao abre pergunta', () => {
  const id = createCard({ title: 'sem destino', status: 'EXECUTING', repo: 'org/repo' }, 'x')
  applyFailurePolicy({
    id, fromStatus: 'EXECUTING', resumeStatus: 'EXECUTING', provider: 'claude', papel: 'implement',
    failureClass: 'quota', failureReason: 'cota', technicalDetail: '',
    rota: () => ({ acao: 'manter_politica_atual', motivo: 'nenhum candidato' }),
  })
  expect(readCard(id)?.fm.status).toBe('HALTED')
  expect(pendencia(id)).toBeNull()
})
