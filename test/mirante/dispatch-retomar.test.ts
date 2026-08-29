import { test, expect, beforeEach } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handle, newSession } from '../../motor/mirante/sessao.ts'
import type { SessionState } from '../../motor/mirante/sessao.ts'
import { dispatchIOFalso } from '../fixtures/dispatch-io-falso.ts'

let dir = ''
let saida: string[] = []

const io = dispatchIOFalso({
  log: (l: string) => { saida.push(l) },
  plano: async (id: string) => [`plano do #${id}`],
  responder: async (pergunta: string) => [`resposta para: ${pergunta}`],
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hicode-disp-retomar-'))
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
  const { dispatch } = await import('../../motor/mirante/despacho.ts')
  let state = inicial ?? newSession('org/app')
  for (const linha of linhas) {
    const r = handle(linha, state)
    state = (await dispatch(r.effect, r.state, io)).state
  }
  return state
}

test('retomar so vale para tarefa parada', async () => {
  const { readCard } = await import('../../motor/cordel/store.ts')
  const { retomando } = await import('../../motor/mirante/sessao.ts')
  card('022', { status: 'HALTED' })
  await digitar([''], retomando(newSession('org/app'), '022'))
  expect(readCard('022')?.fm.status).toBe('EXECUTING')
})

test('retomar tarefa que nao esta parada nao mexe no estado', async () => {
  const { readCard } = await import('../../motor/cordel/store.ts')
  const { retomando } = await import('../../motor/mirante/sessao.ts')
  card('022', { status: 'URL' })
  await digitar([''], retomando(newSession('org/app'), '022'))
  expect(readCard('022')?.fm.status).toBe('URL')
  expect(saida.join(' ')).toContain('nao ha o que retomar')
})

test('retomar card inexistente avisa', async () => {
  const { retomando } = await import('../../motor/mirante/sessao.ts')
  await digitar([''], retomando(newSession('org/app'), '099'))
  expect(saida.join(' ')).toContain('nao encontrado')
})
