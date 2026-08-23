import { test, expect, beforeEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handle, newSession } from '../motor/mir/sessao'
import type { SessionState } from '../motor/mir/sessao'
import { dispatchIOFalso } from './fixtures/dispatch-io-falso'

let dir = ''
let saida: string[] = []

const io = dispatchIOFalso({
  log: (l: string) => { saida.push(l) },
  plano: async (id: string) => [`plano do #${id}`],
  responder: async (pergunta: string) => [`resposta para: ${pergunta}`],
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hicode-disp-repo-'))
  mkdirSync(join(dir, 'runs'), { recursive: true })
  process.env.HICODE_CARDS_DIR = dir
  saida = []
})

async function digitar(linhas: string[], inicial?: SessionState): Promise<SessionState> {
  const { dispatch } = await import('../motor/mir/despacho')
  let state = inicial ?? newSession('org/app')
  for (const linha of linhas) {
    const r = handle(linha, state)
    state = (await dispatch(r.effect, r.state, io)).state
  }
  return state
}

const REGISTRO = [{ name: 'acme/site', path: '/tmp/site' }, { name: 'acme/api', path: '/tmp/api' }]

function comRepos(): void {
  writeFileSync(join(dir, '..', 'repos-teste.json'), JSON.stringify(REGISTRO))
  process.env.HICODE_REPOS_FILE = join(dir, '..', 'repos-teste.json')
}

test('escolher projeto por numero muda o alvo', async () => {
  comRepos()
  const state = await digitar(['/repo', '2'])
  expect(state.repo).toBe('acme/api')
  expect(saida.join(' ')).toContain('projeto agora e acme/api')
})

test('escolher projeto por nome parcial funciona quando e unico', async () => {
  comRepos()
  expect((await digitar(['/repo api'])).repo).toBe('acme/api')
})

test('nome que combina com varios pede desempate em vez de chutar', async () => {
  comRepos()
  const state = await digitar(['/repo acme'])
  expect(state.repo).toBe('org/app')
  expect(saida.join(' ')).toContain('combina com 2 projetos')
})

test('projeto nao registrado e RECUSADO, com a lista do que existe', async () => {
  comRepos()
  const state = await digitar(['/repo qualquer/coisa'])
  expect(state.repo).toBe('org/app')
  expect(saida.join(' ')).toContain('nao esta registrado')
  expect(saida.join(' ')).toContain('acme/site')
  expect(saida.join(' ')).toContain('hii repo add')
})

test('trocar de projeto solta a tarefa aberta do projeto anterior', async () => {
  comRepos()
  const { seguir } = await import('../motor/mir/sessao')
  const state = await digitar(['/repo 1'], seguir(newSession('org/app'), '022'))
  expect(state.repo).toBe('acme/site')
  expect(state.seguindo).toBe('')
})

test('/repo sem argumento lista os projetos registrados', async () => {
  comRepos()
  const state = await digitar(['/repo'])
  expect(state.escolhendo).toBe(true)
  expect(saida.join(' ')).toContain('acme/site')
  expect(saida.join(' ')).toContain('acme/api')
})

test('sem projeto registrado, ensina a registrar', async () => {
  writeFileSync(join(dir, '..', 'repos-vazio.json'), '[]')
  process.env.HICODE_REPOS_FILE = join(dir, '..', 'repos-vazio.json')
  await digitar(['/repo'])
  expect(saida.join(' ')).toContain('nenhum projeto registrado')
})
