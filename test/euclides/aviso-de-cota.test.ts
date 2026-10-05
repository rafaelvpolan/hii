import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { JanelaDeProvedor } from '../../motor/euclides/tesouro/janelas.ts'

const CARDS = mkdtempSync(join(tmpdir(), 'hii-aviso-cota-'))
process.env.HII_CARDS_DIR = CARDS
afterAll(() => {
  rmSync(CARDS, { recursive: true, force: true })
  delete process.env.HII_COTA_AVISO_PCT
})

const { createCard, readCard } = await import('../../motor/cordel/store.ts')
const { avisarCotaPerto, janelaPertoDoLimite } = await import('../../motor/euclides/tesouro/aviso-de-cota.ts')

function janela(percentual: number | null, confiavel = true, resetaEm = '2026-10-04T20:00:00Z'): JanelaDeProvedor {
  return { rotulo: '5h', ms: 18_000_000, inicioMs: 0, fimMs: 1, percentualDoLimite: percentual, limiteConfiavel: confiavel, resetaEm, restamMs: 60_000 }
}

test('janela abaixo do limiar, sem medicao ou nao confiavel nao gera aviso', () => {
  expect(janelaPertoDoLimite([janela(50)], 80)).toBeNull()
  expect(janelaPertoDoLimite([janela(null)], 80)).toBeNull()
  expect(janelaPertoDoLimite([janela(95, false)], 80)).toBeNull()
})

test('limiar zero desliga o aviso', () => {
  expect(janelaPertoDoLimite([janela(99)], 0)).toBeNull()
})

test('cota perto do fim grava o aviso com a IA recomendada, uma vez por janela', () => {
  const id = createCard({ title: 'tarefa', status: 'EXECUTING', repo: 'org/repo' }, 'x')
  const rota = () => ({ acao: 'trocar' as const, para: 'ollama', motivo: 'apto' })
  const texto = avisarCotaPerto({ id, provedor: 'claude', papel: 'implement', janelas: [janela(86)], rota })
  expect(texto).toContain('cota de claude em 86% da janela 5h')
  expect(texto).toContain('recomendado para a troca: ollama')
  expect(readCard(id)?.fm.cota_aviso).toBe(texto)
  expect(avisarCotaPerto({ id, provedor: 'claude', papel: 'implement', janelas: [janela(90)], rota })).toBe('')
  expect(avisarCotaPerto({ id, provedor: 'claude', papel: 'implement', janelas: [janela(90, true, '2026-10-05T01:00:00Z')], rota })).not.toBe('')
})

test('sem destino apto o aviso diz que nao ha troca possivel', () => {
  const id = createCard({ title: 'tarefa', status: 'EXECUTING', repo: 'org/repo' }, 'x')
  const texto = avisarCotaPerto({ id, provedor: 'codex', papel: 'step', janelas: [janela(81)], rota: () => ({ acao: 'manter_politica_atual', motivo: '' }) })
  expect(texto).toContain('nenhuma outra IA apta')
})

test('HII_COTA_AVISO_PCT ajusta o limiar', () => {
  process.env.HII_COTA_AVISO_PCT = '95'
  try {
    expect(janelaPertoDoLimite([janela(90)])).toBeNull()
    expect(janelaPertoDoLimite([janela(96)])).not.toBeNull()
  } finally {
    delete process.env.HII_COTA_AVISO_PCT
  }
})
