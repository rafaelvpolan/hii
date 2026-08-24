import { test, expect, beforeEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handle, newSession } from '../../motor/mir/sessao.ts'
import type { SessionState } from '../../motor/mir/sessao.ts'
import { dispatchIOFalso } from '../fixtures/dispatch-io-falso.ts'

let dir = ''
let saida: string[] = []

const io = dispatchIOFalso({
  log: (l: string) => { saida.push(l) },
  plano: async (id: string) => [`plano do #${id}`],
  responder: async (pergunta: string) => [`resposta para: ${pergunta}`],
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hicode-disp-instr-'))
  mkdirSync(join(dir, 'runs'), { recursive: true })
  process.env.HICODE_CARDS_DIR = dir
  saida = []
})

function card(id: string, fields: Record<string, string> = {}): void {
  const fm = Object.entries({ id, status: 'READY', title: `tarefa ${id}`, repo: 'org/app', ...fields })
    .map(([k, v]) => `${k}: ${v}`).join('\n')
  writeFileSync(join(dir, `${id}-x.md`), `---\n${fm}\n---\n## Objetivo\nx\n`)
}

async function digitar(linhas: string[], inicial?: SessionState): Promise<SessionState> {
  const { dispatch } = await import('../../motor/mir/despacho.ts')
  let state = inicial ?? newSession('org/app')
  for (const linha of linhas) {
    const r = handle(linha, state)
    state = (await dispatch(r.effect, r.state, io)).state
  }
  return state
}

test('FLUXO REAL: instrucao dentro da tarefa entra como sub-prompt, sem confirmar', async () => {
  const { subPrompts } = await import('../../motor/mir/instruir.ts')
  const { readCard } = await import('../../motor/cdl/store.ts')
  const { seguir } = await import('../../motor/mir/sessao.ts')
  card('022', { status: 'EXECUTED', worktree: dir })
  await digitar(['tira tambem o do hero'], seguir(newSession('org/app'), '022'))
  const c = readCard('022')
  expect(subPrompts(c?.body ?? '')).toEqual(['tira tambem o do hero'])
  expect(c?.fm.status).toBe('CORRECTING')
  expect(saida.join(' ')).toContain('instrucao 1 anotada')
})

test('FLUXO REAL: nenhuma tarefa nova nasce de uma instrucao', async () => {
  const { allCards } = await import('../../motor/cdl/store.ts')
  const { seguir } = await import('../../motor/mir/sessao.ts')
  card('022', { status: 'EXECUTED' })
  const antes = allCards().length
  await digitar(['muda mais isso', 'e aquilo'], seguir(newSession('org/app'), '022'))
  expect(allCards().length).toBe(antes)
})

test('PEDIDO em tarefa que sumiu vira tarefa nova, sem perder o texto', async () => {
  const { seguir } = await import('../../motor/mir/sessao.ts')
  const { allCards } = await import('../../motor/cdl/store.ts')
  const state = await digitar(['tira tambem o do hero'], seguir(newSession('org/app'), '099'))
  const novos = allCards()
  expect(novos.length).toBe(1)
  const idNovo = novos[0]?.id
  if (idNovo === undefined) throw new Error('a instrucao perdida nao virou tarefa nova com id')
  expect(novos[0]?.title).toBe('tira tambem o do hero')
  expect(state.seguindo).toBe(idNovo)
  expect(saida.join(' ')).toContain('nao existe mais')
})

test('REGRESSAO: texto em tarefa que sumiu tambem vira tarefa nova — nao ha mais leitura de intencao', async () => {
  const { seguir } = await import('../../motor/mir/sessao.ts')
  const { allCards } = await import('../../motor/cdl/store.ts')
  const state = await digitar(['tem acesso ao notion pelo claude?'], seguir(newSession('org/app'), '099'))
  const novo = allCards()[0]?.id
  if (!novo) throw new Error('o card criado ficou sem id')
  expect(allCards().length).toBe(1)
  expect(state.seguindo).toBe(novo)
  expect(saida.join(' ')).toContain('nao existe mais')
})

test('a tarefa nova entra direto na fila, sem esperar aprovacao', async () => {
  const { seguir } = await import('../../motor/mir/sessao.ts')
  const { allCards } = await import('../../motor/cdl/store.ts')
  await digitar(['remove o header de beta'], seguir(newSession('org/app'), '099'))
  expect(allCards()[0]?.status).toBe('EXECUTING')
  expect(saida.join(' ')).toContain('na fila')
})

test('sem projeto, instrucao orfa nao cria nada', async () => {
  const { seguir } = await import('../../motor/mir/sessao.ts')
  const { allCards } = await import('../../motor/cdl/store.ts')
  await digitar(['remove o texto solto'], seguir(newSession(''), '099'))
  expect(allCards().length).toBe(0)
  expect(saida.join(' ')).toContain('sem projeto')
})
