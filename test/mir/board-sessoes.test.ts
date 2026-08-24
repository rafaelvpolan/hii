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
  cardEmDisco('010', 'MERGED')
  cardEmDisco('011', 'MERGED')
  cardEmDisco('020', 'EXECUTING')
  const { ordemDoRodape, historicoDaTela } = await import('../../motor/mir/cli/board-tui.ts')
  const { newSession } = await import('../../motor/mir/sessao.ts')
  const state = newSession('org/app')
  historicoDaTela(12)
  const board = ordemDoRodape(state, 'board')
  expect(board).toEqual([recente, antigo])
  expect(board).not.toContain('020')
  expect(ordemDoRodape(state, 'rodape')).toEqual(['020'])
})

test('varias sessoes do mesmo card sao itens distintos e navegaveis uma por uma', async () => {
  const primeira = sessaoEmDisco('010', 2 * 3600_000)
  const segunda = sessaoEmDisco('010', 3600_000)
  cardEmDisco('010', 'MERGED')
  expect(primeira).not.toBe(segunda)
  const { ordemDoRodape, historicoDaTela, navegar } = await import('../../motor/mir/cli/board-tui.ts')
  const { newSession } = await import('../../motor/mir/sessao.ts')
  const { selecionado, selecionar } = await import('../../motor/mir/cli/estado.ts')
  const state = newSession('org/app')
  historicoDaTela(12)
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
  cardEmDisco('010', 'MERGED')
  cardEmDisco('011', 'MERGED')
  const { historicoDaTela, navegar } = await import('../../motor/mir/cli/board-tui.ts')
  const { newSession } = await import('../../motor/mir/sessao.ts')
  const { selecionar } = await import('../../motor/mir/cli/estado.ts')
  const { stripAnsi } = await import('../../motor/mir/tui/layout.ts')
  const state = newSession('org/app')
  historicoDaTela(12)
  selecionar('')
  navegar(state, 1, 'board')
  const marcadas = historicoDaTela(12).map(stripAnsi).filter(l => l.includes('▸'))
  expect(marcadas.length).toBe(1)
  expect(marcadas[0]).toContain('#011')
})

test('REGRESSAO: dentro de uma tarefa, o modo board mostra as sessoes em vez do seguimento', async () => {
  sessaoEmDisco('010', 3600_000)
  cardEmDisco('010', 'MERGED')
  cardEmDisco('020', 'EXECUTING')
  const { corpoDaTela } = await import('../../motor/mir/cli/board-tui.ts')
  const { newSession, seguir } = await import('../../motor/mir/sessao.ts')
  const { stripAnsi } = await import('../../motor/mir/tui/layout.ts')
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
  const { alvoDeEntrada } = await import('../../motor/mir/cli/board-tui.ts')
  const { newSession } = await import('../../motor/mir/sessao.ts')
  const { selecionar } = await import('../../motor/mir/cli/estado.ts')
  selecionar(chave)
  expect(alvoDeEntrada('board', newSession('org/app'))).toEqual({ kind: 'tarefa', id: '010' })
})

test('o board so mostra sessoes do projeto atual, mesmo com sessoes de outro projeto no disco', async () => {
  sessaoEmDisco('010', 3600_000)
  const chave011 = sessaoEmDisco('011', 7200_000)
  cardEmDisco('010', 'MERGED')
  const fm = { id: '011', status: 'MERGED', title: 'tarefa 011', repo: 'outra/coisa', updated: new Date().toISOString() }
  const cabeca = Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join('\n')
  writeFileSync(join(dir, '011-slug.md'), `---\n${cabeca}\n---\n## Objetivo\nx\n`)
  const { ordemDoRodape, historicoDaTela } = await import('../../motor/mir/cli/board-tui.ts')
  const { newSession } = await import('../../motor/mir/sessao.ts')
  const state = newSession('org/app')
  const linhas = historicoDaTela(12, state.repo)
  expect(linhas.join('\n')).toContain('#010')
  expect(linhas.join('\n')).not.toContain('#011')
  expect(ordemDoRodape(state, 'board')).not.toContain(chave011)
})

test('REGRESSAO: fora do modo board, o /historico continua global — nao esconde sessoes de outros projetos nem o gasto delas', async () => {
  sessaoEmDisco('010', 3600_000)
  const fm = { id: '010', status: 'MERGED', title: 'tarefa 010', repo: 'outra/coisa', updated: new Date().toISOString() }
  const cabeca = Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join('\n')
  writeFileSync(join(dir, '010-slug.md'), `---\n${cabeca}\n---\n## Objetivo\nx\n`)
  const { corpoDaTela } = await import('../../motor/mir/cli/board-tui.ts')
  const { newSession } = await import('../../motor/mir/sessao.ts')
  const { stripAnsi } = await import('../../motor/mir/tui/layout.ts')
  const state = newSession('org/app')
  const global = corpoDaTela(state, { navegando: '', altura: 12 }).map(stripAnsi).join('\n')
  const board = corpoDaTela(state, { navegando: 'board', altura: 12 }).map(stripAnsi).join('\n')
  expect(global).toContain('#010')
  expect(board).not.toContain('#010')
})

test('projeto sem nenhuma sessao mostra um aviso especifico, nao a lista generica vazia', async () => {
  sessaoEmDisco('010', 3600_000)
  const fm = { id: '010', status: 'MERGED', title: 'tarefa 010', repo: 'outra/coisa', updated: new Date().toISOString() }
  const cabeca = Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join('\n')
  writeFileSync(join(dir, '010-slug.md'), `---\n${cabeca}\n---\n## Objetivo\nx\n`)
  const { historicoDaTela } = await import('../../motor/mir/cli/board-tui.ts')
  const linhas = historicoDaTela(12, 'org/app').join('\n')
  expect(linhas).toContain('nenhuma sessao de org/app')
  expect(linhas).not.toContain('escreva a primeira tarefa')
})

test('REGRESSAO: enter no /config com selecao invalida ou de outra tela aplica o mesmo provedor que a lista realca', async () => {
  const { alvoDeEntrada } = await import('../../motor/mir/cli/board-tui.ts')
  const { providerNames } = await import('../../motor/tmd/registro.ts')
  const { newSession } = await import('../../motor/mir/sessao.ts')
  const { selecionar } = await import('../../motor/mir/cli/estado.ts')
  const naConfig = { ...newSession('org/app'), tela: 'config' as const }
  const primeiro = providerNames()[0] ?? ''
  selecionar('')
  expect(alvoDeEntrada('rodape', naConfig)).toEqual({ kind: 'provedor', nome: primeiro })
  selecionar('42')
  expect(alvoDeEntrada('rodape', naConfig)).toEqual({ kind: 'provedor', nome: primeiro })
})

test('com /config aberto, a seta de baixo continua escolhendo provedor na tela', async () => {
  const { navegarNaTela, alvoDeEntrada } = await import('../../motor/mir/cli/board-tui.ts')
  const { providerNames } = await import('../../motor/tmd/registro.ts')
  const { newSession } = await import('../../motor/mir/sessao.ts')
  const { selecionado, selecionar } = await import('../../motor/mir/cli/estado.ts')
  const naConfig = { ...newSession('org/app'), tela: 'config' as const }
  selecionar('')
  expect(navegarNaTela(naConfig, 1, 'rodape')).toBe(true)
  expect(providerNames() as string[]).toContain(selecionado())
  expect(alvoDeEntrada('rodape', naConfig)).toEqual({ kind: 'provedor', nome: selecionado() })
})
