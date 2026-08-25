import { test, expect, beforeEach, afterEach } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handle, newSession, seguir } from '../../motor/mir/sessao.ts'
import { dispatch } from '../../motor/mir/despacho.ts'
import { dispatchIOFalso } from '../fixtures/dispatch-io-falso.ts'
import { allCards } from '../../motor/cdl/store.ts'

let dir = ''
let claudeHome = ''
let saida: string[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hicode-dispatch-ia-'))
  mkdirSync(join(dir, 'runs'), { recursive: true })
  process.env.HICODE_CARDS_DIR = dir
  process.env.HICODE_IA_FILE = join(dir, 'ia.json')
  claudeHome = mkdtempSync(join(tmpdir(), 'hicode-claude-home-'))
  mkdirSync(join(claudeHome, 'commands'), { recursive: true })
  writeFileSync(join(claudeHome, 'commands', 'review.md'), '---\ndescription: "revisa o diff"\n---\ncorpo\n')
  process.env.HICODE_CLAUDE_HOME_DIR = claudeHome
  process.env.HICODE_IMPLEMENT_PROVIDER = 'claude'
  saida = []
})

afterEach(() => {
  delete process.env.HICODE_CARDS_DIR
  delete process.env.HICODE_IA_FILE
  delete process.env.HICODE_CLAUDE_HOME_DIR
  delete process.env.HICODE_IMPLEMENT_PROVIDER
})

const io = dispatchIOFalso({ log: (l: string) => { saida.push(l) } })

function card(id: string, fields: Record<string, string> = {}): void {
  const fm = Object.entries({ id, status: 'EXECUTED', title: `tarefa ${id}`, repo: 'org/app', ...fields })
    .map(([k, v]) => `${k}: ${v}`).join('\n')
  writeFileSync(join(dir, `${id}-x.md`), `---\n${fm}\n---\n## Objetivo\nx\n`)
}

test('/review (comando da ia ativa) dentro de uma tarefa aberta vira instrucao anexada, sem criar card nem autoaprovar', async () => {
  const { subPrompts } = await import('../../motor/mir/instruir.ts')
  const { readCard } = await import('../../motor/cdl/store.ts')
  card('022', { worktree: dir })
  const antes = allCards().length
  const state = seguir(newSession('org/app'), '022')
  const r = handle('/review o pull request', state)
  expect(r.effect.kind).toBe('error')
  const d = await dispatch(r.effect, r.state, io)
  expect(allCards().length).toBe(antes)
  const c = readCard('022')
  expect(subPrompts(c?.body ?? '')).toEqual(['/review o pull request'])
  expect(c?.fm.status).toBe('CORRECTING')
  expect(saida.join(' ')).not.toContain('comando desconhecido')
  expect(saida.join(' ')).toContain('/review')
  expect(d.state.seguindo).toBe('022')
})

test('/review (comando da ia ativa) sem tarefa aberta continua avisando, sem criar nem executar nada', async () => {
  const antes = allCards().length
  const state = newSession('org/app')
  const r = handle('/review o pull request', state)
  const d = await dispatch(r.effect, r.state, io)
  expect(allCards().length).toBe(antes)
  expect(saida.join(' ')).toContain('comando desconhecido')
  expect(d.state.seguindo).toBe('')
})

test('/xpto (nao existe em lugar nenhum) continua avisando, sem virar tarefa', async () => {
  const antes = allCards().length
  const state = newSession('org/app')
  const r = handle('/xpto', state)
  const d = await dispatch(r.effect, r.state, io)
  expect(allCards().length).toBe(antes)
  expect(saida.join(' ')).toContain('comando desconhecido')
  expect(d.state.seguindo).toBe('')
})

test('REGRESSAO tarefa aberta que sumiu do disco NAO deixa comando da ia virar card novo autoaprovado', async () => {
  const antes = allCards().length
  const state = seguir(newSession('org/app'), '404')
  const r = handle('/review o pull request', state)
  const d = await dispatch(r.effect, r.state, io)
  expect(allCards().length).toBe(antes)
  expect(saida.join(' ')).toContain('comando desconhecido')
  expect(saida.join(' ')).not.toContain('criado')
  expect(d.state.seguindo).toBe('404')
})
