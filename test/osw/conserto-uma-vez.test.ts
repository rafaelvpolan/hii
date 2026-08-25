import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Card, ImplementResult } from '../../motor/cdl/index.ts'
import type { ExecuteDeps } from '../../motor/osw/executar.ts'

const BASE = mkdtempSync(join(tmpdir(), 'hii-conserto-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(process.env.HICODE_CARDS_DIR, { recursive: true })

const { createCard, readCard } = await import('../../motor/cdl/store.ts')
const { consertarUmaVez } = await import('../../motor/osw/executar.ts')

afterAll(() => rmSync(BASE, { recursive: true, force: true }))

function cardNoDisco(): Card {
  const id = createCard({ title: 'tela do relatorio', status: 'URL', repo: 'org/repo', surface: 'visual' }, '## Objetivo\nx\n')
  const c = readCard(id)
  if (!c) throw new Error('card nao criado')
  return c
}

interface Chamadas {
  implement: number
  inspecionar: number
}

function deps(over: { consertoOk?: boolean; depoisOk?: boolean; conclusive?: boolean }, chamadas: Chamadas): ExecuteDeps {
  return {
    implement: (): Promise<ImplementResult> => {
      chamadas.implement += 1
      return Promise.resolve({
        ok: over.consertoOk !== false,
        resultText: 'importei o modulo que faltava',
        fullText: '',
        cost: '0.0200',
        usage: { tokens_in: 5, tokens_out: 5, tokens_cache_create: 0, tokens_cache_read: 0 },
      })
    },
    verifyVisual: (): Promise<never> => Promise.reject(new Error('nao deveria chamar')),
    inspecionar: () => {
      chamadas.inspecionar += 1
      return Promise.resolve({ ok: over.depoisOk === true, conclusive: over.conclusive !== false, detail: 'ReferenceError: x is not defined' })
    },
  }
}

test('pagina com erro: o motor conserta UMA vez e, dando certo, nao chama o humano', async () => {
  const card = cardNoDisco()
  const chamadas: Chamadas = { implement: 0, inspecionar: 0 }
  const r = await consertarUmaVez(card.fm.id ?? '', card, '/tmp/wt', 'http://localhost:5200', 'TypeError: undefined', deps({ depoisOk: true }, chamadas))
  expect(r.vstate).toBe('ok')
  expect(r.vreason).toContain('o motor consertou')
  expect(chamadas.implement).toBe(1)
  expect(chamadas.inspecionar).toBe(1)
})

test('UMA VEZ SO: se o conserto nao resolveu, para e chama o humano em vez de insistir', async () => {
  const card = cardNoDisco()
  const chamadas: Chamadas = { implement: 0, inspecionar: 0 }
  const r = await consertarUmaVez(card.fm.id ?? '', card, '/tmp/wt', 'http://localhost:5200', 'TypeError: undefined', deps({ depoisOk: false }, chamadas))
  expect(r.vstate).toBe('falhou')
  expect(r.vreason).toContain('precisa de voce')
  expect(chamadas.implement).toBe(1)
})

test('se a propria tentativa de conserto falha, nem reinspeciona e ja chama o humano', async () => {
  const card = cardNoDisco()
  const chamadas: Chamadas = { implement: 0, inspecionar: 0 }
  const r = await consertarUmaVez(card.fm.id ?? '', card, '/tmp/wt', 'http://localhost:5200', 'erro', deps({ consertoOk: false }, chamadas))
  expect(r.vstate).toBe('falhou')
  expect(r.vreason).toContain('tentativa de conserto falhou')
  expect(chamadas.implement).toBe(1)
  expect(chamadas.inspecionar).toBe(0)
})

test('inspecao inconclusiva depois do conserto nao vira aprovacao automatica', async () => {
  const card = cardNoDisco()
  const chamadas: Chamadas = { implement: 0, inspecionar: 0 }
  const r = await consertarUmaVez(card.fm.id ?? '', card, '/tmp/wt', 'http://localhost:5200', 'erro', deps({ depoisOk: true, conclusive: false }, chamadas))
  expect(r.vstate).toBe('falhou')
})

test('o custo da tentativa de conserto entra na conta, nao some', async () => {
  const card = cardNoDisco()
  const chamadas: Chamadas = { implement: 0, inspecionar: 0 }
  const r = await consertarUmaVez(card.fm.id ?? '', card, '/tmp/wt', 'http://localhost:5200', 'erro', deps({ depoisOk: true }, chamadas))
  expect(r.custo).toBe(0.02)
  expect(r.tokens).toBe(10)
})

test('a tentativa fica registrada no card, para o humano saber que o motor ja tentou', async () => {
  const card = cardNoDisco()
  const chamadas: Chamadas = { implement: 0, inspecionar: 0 }
  await consertarUmaVez(card.fm.id ?? '', card, '/tmp/wt', 'http://localhost:5200', 'ReferenceError', deps({ depoisOk: false }, chamadas))
  const depois = readCard(card.fm.id ?? '')
  expect(depois?.body).toContain('uma tentativa automatica de conserto')
})
