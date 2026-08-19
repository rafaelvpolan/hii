import { test, expect, beforeEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dir = ''

function carimbo(ms: number): string {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
}

function sessaoEmDisco(card: string, hasMs: number): string {
  const quando = new Date(Date.now() - hasMs)
  const arquivo = `${card}-${carimbo(quando.getTime())}.json`
  writeFileSync(join(dir, 'runs', arquivo), JSON.stringify({
    id: card, ts: quando.toISOString(), ok: true, cost_usd: '0.12', duration_s: 90,
    tokens_total: 12000, provider: 'claude', model: 'claude-opus-5',
  }))
  return arquivo
}

function cardEmDisco(id: string, status: string): void {
  const fm = { id, status, title: `tarefa ${id}`, repo: 'org/app', updated: new Date().toISOString() }
  const cabeca = Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join('\n')
  writeFileSync(join(dir, `${id}-slug.md`), `---\n${cabeca}\n---\n## Objetivo\nx\n`)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hii-board-'))
  mkdirSync(join(dir, 'runs'), { recursive: true })
  process.env.HICODE_CARDS_DIR = dir
  process.env.HICODE_IA_FILE = join(dir, 'ia.json')
})

test('o modo board tem ordem propria, vinda das sessoes, e nao a lista de cards do rodape', async () => {
  const antigo = sessaoEmDisco('010', 3 * 3600_000)
  const recente = sessaoEmDisco('011', 3600_000)
  cardEmDisco('020', 'EXECUTING')
  const { ordemDoRodape, historicoDaTela } = await import('../bin/lib/board-tui')
  const { newSession } = await import('../lib/core/session')
  const state = newSession('org/app')
  historicoDaTela(state, 12)
  const board = ordemDoRodape(state, 'board')
  expect(board).toEqual([recente, antigo])
  expect(board).not.toContain('020')
  expect(ordemDoRodape(state, 'rodape')).toEqual(['020'])
})

test('varias sessoes do mesmo card sao itens distintos e navegaveis uma por uma', async () => {
  const primeira = sessaoEmDisco('010', 2 * 3600_000)
  const segunda = sessaoEmDisco('010', 3600_000)
  expect(primeira).not.toBe(segunda)
  const { ordemDoRodape, historicoDaTela, navegar } = await import('../bin/lib/board-tui')
  const { newSession } = await import('../lib/core/session')
  const { selecionado, selecionar } = await import('../bin/lib/estado')
  const state = newSession('org/app')
  historicoDaTela(state, 12)
  expect(ordemDoRodape(state, 'board').length).toBe(2)
  selecionar('')
  navegar(state, 1, 'board')
  const primeiroAlvo = selecionado()
  navegar(state, 1, 'board')
  expect(selecionado()).not.toBe(primeiroAlvo)
})

test('a seta esquerda realca a sessao escolhida na lista', async () => {
  sessaoEmDisco('010', 2 * 3600_000)
  sessaoEmDisco('011', 3600_000)
  const { historicoDaTela, navegar } = await import('../bin/lib/board-tui')
  const { newSession } = await import('../lib/core/session')
  const { selecionar } = await import('../bin/lib/estado')
  const { stripAnsi } = await import('../lib/core/tui/layout')
  const state = newSession('org/app')
  historicoDaTela(state, 12)
  selecionar('')
  navegar(state, 1, 'board')
  const marcadas = historicoDaTela(state, 12).map(stripAnsi).filter(l => l.includes('▸'))
  expect(marcadas.length).toBe(1)
  expect(marcadas[0]).toContain('#011')
})

test('REGRESSAO: dentro de uma tarefa, o modo board mostra as sessoes em vez do seguimento', async () => {
  sessaoEmDisco('010', 3600_000)
  cardEmDisco('020', 'EXECUTING')
  const { corpoDaTela } = await import('../bin/lib/board-tui')
  const { newSession, seguir } = await import('../lib/core/session')
  const { stripAnsi } = await import('../lib/core/tui/layout')
  const dentro = seguir(newSession('org/app'), '020')
  const naTarefa = corpoDaTela(dentro, { navegando: '', altura: 12 }).map(stripAnsi).join('\n')
  const noBoard = corpoDaTela(dentro, { navegando: 'board', altura: 12 }).map(stripAnsi).join('\n')
  expect(naTarefa).not.toContain('historico de sessoes')
  expect(noBoard).toContain('historico de sessoes')
  expect(noBoard).toContain('#010')
})

test('enter no modo board abre a tarefa daquela sessao', async () => {
  const chave = sessaoEmDisco('010', 3600_000)
  cardEmDisco('010', 'PR_OPEN')
  const { alvoDeEntrada } = await import('../bin/lib/board-tui')
  const { newSession } = await import('../lib/core/session')
  const { selecionar } = await import('../bin/lib/estado')
  selecionar(chave)
  expect(alvoDeEntrada('board', newSession('org/app'))).toEqual({ kind: 'tarefa', id: '010' })
})

test('em modo ajustes o enter nao aplica provedor, mesmo com a tela de config aberta', async () => {
  const { alvoDeEntrada } = await import('../bin/lib/board-tui')
  const { newSession } = await import('../lib/core/session')
  const { selecionar } = await import('../bin/lib/estado')
  selecionar('implement:esforco')
  const naConfig = { ...newSession('org/app'), tela: 'config' as const }
  expect(alvoDeEntrada('ajustes', naConfig)).toEqual({ kind: 'nada' })
})

test('REGRESSAO: com /config aberto, shift+tab navega os ajustes que o rodape mostra', async () => {
  const { navegarNaTela } = await import('../bin/lib/board-tui')
  const { ordemDosAjustes, ciclarAjuste } = await import('../lib/core/ajustes')
  const { newSession } = await import('../lib/core/session')
  const { selecionado, selecionar } = await import('../bin/lib/estado')
  const naConfig = { ...newSession('org/app'), tela: 'config' as const }
  selecionar('')
  expect(navegarNaTela(naConfig, 1, 'ajustes')).toBe(true)
  expect(ordemDosAjustes()).toContain(selecionado())
  expect(ciclarAjuste(selecionado(), 1).ok).toBe(true)
})

test('com /config aberto, a seta de baixo continua escolhendo provedor na tela', async () => {
  const { navegarNaTela, alvoDeEntrada } = await import('../bin/lib/board-tui')
  const { providerNames } = await import('../lib/ai/registry')
  const { newSession } = await import('../lib/core/session')
  const { selecionado, selecionar } = await import('../bin/lib/estado')
  const naConfig = { ...newSession('org/app'), tela: 'config' as const }
  selecionar('')
  expect(navegarNaTela(naConfig, 1, 'rodape')).toBe(true)
  expect(providerNames() as string[]).toContain(selecionado())
  expect(alvoDeEntrada('rodape', naConfig)).toEqual({ kind: 'provedor', nome: selecionado() })
})
