import { test, expect, beforeEach, afterEach } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { newSession, seguir } from '../../motor/mirante/sessao.ts'
import type { Effect, SessionState } from '../../motor/mirante/sessao.ts'
import { dispatch } from '../../motor/mirante/despacho.ts'
import { dispatchIOFalso } from '../fixtures/dispatch-io-falso.ts'
import { allCards, readCard } from '../../motor/cordel/store.ts'
import type { Fields } from '../../motor/cordel/tipos.ts'

// Na TUI, um comando de canal leitura da pasta (hii-plan, hii-review,
// hii-review-pr) vira CONSULTA: vai para io.responder e nao toca em tarefa
// nenhuma. Os de escrita (hii-refinar) continuam virando instrucao da tarefa.

let dir = ''
let claudeHome = ''
let saida: string[] = []
let perguntas: string[] = []
const antigo: Record<string, string | undefined> = {}

function guardar(chave: string, valor: string): void {
  if (!(chave in antigo)) antigo[chave] = process.env[chave]
  process.env[chave] = valor
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hii-leitura-tui-'))
  mkdirSync(join(dir, 'runs'), { recursive: true })
  claudeHome = mkdtempSync(join(tmpdir(), 'hii-leitura-tui-claude-'))
  guardar('HII_CARDS_DIR', dir)
  guardar('HII_IA_FILE', join(dir, 'ia.json'))
  guardar('HII_CLAUDE_HOME_DIR', claudeHome)
  guardar('HII_IMPLEMENT_PROVIDER', 'claude')
  guardar('HII_VERIFY_PROVIDER', 'claude')
  saida = []
  perguntas = []
})

afterEach(() => {
  for (const [chave, valor] of Object.entries(antigo)) {
    if (valor === undefined) delete process.env[chave]
    else process.env[chave] = valor
    delete antigo[chave]
  }
  rmSync(dir, { recursive: true, force: true })
  rmSync(claudeHome, { recursive: true, force: true })
})

const io = dispatchIOFalso({
  log: (l: string) => { saida.push(l) },
  responder: async (pergunta: string) => {
    perguntas.push(pergunta)
    return ['resposta da consulta']
  },
})

function card(id: string, status = 'EXECUTED'): void {
  const fm = Object.entries({ id, status, title: `tarefa ${id}`, repo: 'org/app' })
    .map(([k, v]) => `${k}: ${v}`).join('\n')
  writeFileSync(join(dir, `${id}-x.md`), `---\n${fm}\n---\n## Objetivo\nx\n`)
}

function statusDeTodas(): Record<string, string> {
  return Object.fromEntries(allCards().map((c: Fields & { file: string }): [string, string] => [c.id ?? '', c.status ?? '']))
}

function erro(nome: string, raw = nome): Effect {
  return { kind: 'error', id: nome, raw }
}

async function consultarSemEfeito(efeito: Effect, state: SessionState, esperado: string): Promise<void> {
  const antes = statusDeTodas()
  const corposAntes = allCards().map(c => c.body)
  const r = await dispatch(efeito, state, io)
  expect(r.tratado).toBe(true)
  expect(perguntas).toEqual([esperado])
  expect(statusDeTodas()).toEqual(antes)
  expect(allCards().map(c => c.body)).toEqual(corposAntes)
  expect(saida.join(' ')).not.toContain('comando desconhecido')
  expect(saida.join(' ')).not.toContain('anotado como instrucao')
}

test('comando-de-leitura-na-tui: hii-review sem tarefa seguida vira consulta (responder recebe /hii-review)', async () => {
  card('030')
  await consultarSemEfeito(erro('hii-review'), newSession('org/app'), '/hii-review')
})

test('comando-de-leitura-na-tui: hii-review com tarefa seguida vira consulta e nenhuma tarefa muda de status', async () => {
  card('031')
  card('032', 'CORRECTING')
  const state = seguir(newSession('org/app'), '031')
  await consultarSemEfeito(erro('hii-review'), state, '/hii-review')
  expect(readCard('031')?.fm.status).toBe('EXECUTED')
  expect(readCard('032')?.fm.status).toBe('CORRECTING')
})

test('comando-de-leitura-na-tui: hii-review-pr e hii-plan levam o texto cru para a consulta', async () => {
  card('033')
  const state = seguir(newSession('org/app'), '033')
  await consultarSemEfeito(erro('hii-review-pr', 'hii-review-pr 7'), state, '/hii-review-pr 7')
  perguntas = []
  await consultarSemEfeito(erro('hii-plan', 'hii-plan desenhar o modulo de caixa'), newSession('org/app'), '/hii-plan desenhar o modulo de caixa')
})

test('comando-de-leitura-na-tui: com HII_IMPLEMENT_PROVIDER=codex, hii-review ainda vira consulta', async () => {
  process.env.HII_IMPLEMENT_PROVIDER = 'codex'
  card('034')
  await consultarSemEfeito(erro('hii-review'), seguir(newSession('org/app'), '034'), '/hii-review')
  perguntas = []
  await consultarSemEfeito(erro('hii-review'), newSession('org/app'), '/hii-review')
})

test('comando-de-leitura-na-tui: hii-refinar com tarefa seguida continua virando instrucao, sem consulta', async () => {
  const { subPrompts } = await import('../../motor/mirante/instruir.ts')
  card('035')
  const antes = allCards().length
  const state = seguir(newSession('org/app'), '035')
  const r = await dispatch(erro('hii-refinar', 'hii-refinar organizar'), state, io)
  expect(perguntas).toEqual([])
  expect(allCards().length).toBe(antes)
  expect(subPrompts(readCard('035')?.body ?? '')).toEqual(['/hii-refinar organizar'])
  expect(saida.join(' ')).not.toContain('comando desconhecido')
  expect(r.state.seguindo).toBe('035')
})
