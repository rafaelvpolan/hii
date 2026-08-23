import { test, expect, beforeEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handle, newSession } from '../../motor/mir/sessao'
import type { SessionState } from '../../motor/mir/sessao'
import { dispatchIOFalso } from '../fixtures/dispatch-io-falso'

let dir = ''
let saida: string[] = []

const io = dispatchIOFalso({
  log: (l: string) => { saida.push(l) },
  plano: async (id: string) => [`plano do #${id}`],
  responder: async (pergunta: string) => [`resposta para: ${pergunta}`],
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hicode-disp-rm-'))
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
  const { dispatch } = await import('../../motor/mir/despacho')
  let state = inicial ?? newSession('org/app')
  for (const linha of linhas) {
    const r = handle(linha, state)
    state = (await dispatch(r.effect, r.state, io)).state
  }
  return state
}

test('FLUXO REAL: /rm + s apaga o card do disco', async () => {
  card('025')
  await digitar(['/rm 25', 's'])
  expect(existsSync(join(dir, '025-x.md'))).toBe(false)
})

test('FLUXO REAL: card apagado sai da faixa de espera', async () => {
  const { esperandoVoce } = await import('../../motor/mir/render/rodape')
  const { allCards } = await import('../../motor/cdl/store')
  card('025')
  card('026')
  expect(esperandoVoce(allCards(), 'org/app').length).toBe(2)
  await digitar(['/rm 25', 's'])
  expect(esperandoVoce(allCards(), 'org/app').map(e => e.id)).toEqual(['026'])
})

test('FLUXO REAL: cancelar nao apaga', async () => {
  card('025')
  await digitar(['/rm 25', 'n'])
  expect(existsSync(join(dir, '025-x.md'))).toBe(true)
  expect(saida.join(' ')).toContain('cancelado')
})

test('FLUXO REAL: /rm de card em execucao recusa e nao apaga', async () => {
  card('025', { status: 'EXECUTING' })
  await digitar(['/rm 25'])
  expect(existsSync(join(dir, '025-x.md'))).toBe(true)
  expect(saida.join(' ')).toContain('/stop')
})

test('FLUXO REAL: /rm de card inexistente avisa', async () => {
  await digitar(['/rm 99'])
  expect(saida.join(' ')).toContain('#099 nao existe')
})

test('LOTE: /rm com varios ids apaga todos', async () => {
  card('023'); card('024'); card('025')
  await digitar(['/rm 23 24 25', 's'])
  for (const id of ['023', '024', '025']) expect(existsSync(join(dir, `${id}-x.md`))).toBe(false)
})

test('LOTE: id repetido nao conta duas vezes', async () => {
  card('023')
  await digitar(['/rm 23 23 023', 's'])
  expect(saida.join(' ')).toContain('apagar 1 tarefa')
})

test('LOTE: card em execucao fica de fora, o resto vai', async () => {
  card('023'); card('024', { status: 'EXECUTING' })
  await digitar(['/rm 23 24', 's'])
  expect(existsSync(join(dir, '023-x.md'))).toBe(false)
  expect(existsSync(join(dir, '024-x.md'))).toBe(true)
  expect(saida.join(' ')).toContain('#024 em EXECUTING, fica')
})

test('LOTE: --force leva tambem o que estava em execucao', async () => {
  card('023', { status: 'EXECUTING' })
  await digitar(['/rm 23 --force', 's'])
  expect(existsSync(join(dir, '023-x.md'))).toBe(false)
})

test('LOTE: id inexistente e avisado sem travar os outros', async () => {
  card('023')
  await digitar(['/rm 23 99', 's'])
  expect(saida.join(' ')).toContain('#099 nao existe')
  expect(existsSync(join(dir, '023-x.md'))).toBe(false)
})

test('LOTE: nenhum alvo valido nao pede confirmacao', async () => {
  const state = await digitar(['/rm 98 99'])
  expect(saida.join(' ')).toContain('nada a apagar')
  expect(state.removendo).toBe('')
})

test('LOTE: cancelar preserva todos', async () => {
  card('023'); card('024')
  await digitar(['/rm 23 24', 'n'])
  expect(existsSync(join(dir, '023-x.md'))).toBe(true)
  expect(existsSync(join(dir, '024-x.md'))).toBe(true)
})

test('LOTE: confirmacao relata quantos foram', async () => {
  card('023'); card('024')
  await digitar(['/rm 23 24', 's'])
  expect(saida.join(' ')).toContain('2 apagada(s)')
})

test('apagar a tarefa aberta tira voce de dentro dela', async () => {
  const { seguir } = await import('../../motor/mir/sessao')
  card('022')
  const state = await digitar(['/rm 22', ''], seguir(newSession('org/app'), '022'))
  expect(state.seguindo).toBe('')
  expect(saida.join(' ')).toContain('voltando ao board')
})

test('apagar OUTRA tarefa nao tira voce da que esta aberta', async () => {
  const { seguir } = await import('../../motor/mir/sessao')
  card('022'); card('023')
  const state = await digitar(['/rm 23', ''], seguir(newSession('org/app'), '022'))
  expect(state.seguindo).toBe('022')
})
