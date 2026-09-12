import { test, expect, beforeEach, afterEach } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handle, newSession, seguir } from '../../motor/mirante/sessao.ts'
import { dispatch } from '../../motor/mirante/despacho.ts'
import { dispatchIOFalso } from '../fixtures/dispatch-io-falso.ts'
import { allCards, readCard } from '../../motor/cordel/store.ts'
import { subPrompts } from '../../motor/mirante/instruir.ts'

let dir = ''
let saida: string[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hicode-intake-tarefa-'))
  mkdirSync(join(dir, 'runs'), { recursive: true })
  process.env.HII_CARDS_DIR = dir
  process.env.HII_IA_FILE = join(dir, 'ia.json')
  process.env.HII_IMPLEMENT_PROVIDER = 'claude'
  saida = []
})

afterEach(() => {
  delete process.env.HII_CARDS_DIR
  delete process.env.HII_IA_FILE
  delete process.env.HII_IMPLEMENT_PROVIDER
})

const io = dispatchIOFalso({ log: (l: string) => { saida.push(l) } })

function card(id: string, fields: Record<string, string> = {}): void {
  const fm = Object.entries({ id, status: 'URL', title: `tarefa ${id}`, repo: 'org/app', ...fields })
    .map(([k, v]) => `${k}: ${v}`).join('\n')
  writeFileSync(join(dir, `${id}-x.md`), `---\n${fm}\n---\n## Objetivo\nsubir o preview\n`)
}

test('REGRESSAO card 006: /hii-design dentro de uma tarefa aberta aplica o perfil NELA e anexa o texto como instrucao, sem criar card', async () => {
  card('005', { worktree: dir })
  const antes = allCards().length
  const state = seguir(newSession('org/app'), '005')
  const r = handle('/hii-design melhore o design do site', state)
  expect(r.effect.kind).toBe('intake')
  const d = await dispatch(r.effect, r.state, io)
  expect(allCards().length).toBe(antes)
  const c = readCard('005')
  expect(c?.fm.steps).toBe('nada')
  expect(c?.fm.layout).toBe('on')
  expect(c?.fm.packs).toBe('common,frontend-web')
  expect(subPrompts(c?.body ?? '')).toEqual(['melhore o design do site'])
  expect(c?.fm.status).toBe('CORRECTING')
  expect(c?.body).toContain('perfil /hii-design aplicado pelo humano na tarefa aberta')
  expect(saida.join(' ')).toContain('perfil /hii-design aplicado em #005')
  expect(saida.join(' ')).not.toContain('card #')
  expect(d.state.seguindo).toBe('005')
})

test('/hii-backend numa tarefa aberta troca o perfil sem apagar o que o card ja tinha de outros campos', async () => {
  card('007', { worktree: dir, packs: 'common,frontend-web', layout: 'on', steps: 'nada' })
  const state = seguir(newSession('org/app'), '007')
  const r = handle('/hii-backend endurecer a api', state)
  await dispatch(r.effect, r.state, io)
  const c = readCard('007')
  expect(c?.fm.steps).toBe('testes,seguranca')
  expect(c?.fm.packs).toBe('common,backend-web')
  expect(c?.fm.layout, 'o /hii-backend nao mexe em layout: fica o que estava').toBe('on')
  expect(subPrompts(c?.body ?? '')).toEqual(['endurecer a api'])
})

test('tarefa aberta ja ENTREGUE nao recebe perfil: o atalho volta a criar card novo, como sempre fez', async () => {
  card('008', { status: 'MERGED' })
  const antes = allCards().length
  const state = seguir(newSession('org/app'), '008')
  const r = handle('/hii-design refazer o hero', state)
  const d = await dispatch(r.effect, r.state, io)
  expect(allCards().length).toBe(antes + 1)
  expect(d.state.seguindo).not.toBe('008')
  const novo = readCard(d.state.seguindo)
  expect(novo?.fm.steps).toBe('nada')
  expect(readCard('008')?.fm.steps ?? '').toBe('')
})

test('sem tarefa aberta o atalho continua criando o card com o perfil', async () => {
  const antes = allCards().length
  const r = handle('/hii-design refazer o hero', newSession('org/app'))
  const d = await dispatch(r.effect, r.state, io)
  expect(allCards().length).toBe(antes + 1)
  expect(readCard(d.state.seguindo)?.fm.layout).toBe('on')
})
