import { test, expect, beforeEach } from 'bun:test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handle, newSession } from '../../motor/mir/sessao.ts'
import { dispatch } from '../../motor/mir/despacho.ts'
import { dispatchIOFalso } from '../fixtures/dispatch-io-falso.ts'
import { allCards } from '../../motor/cdl/store.ts'
import { providerNameFor } from '../../motor/tmd/registro.ts'

let saida: string[] = []

const io = dispatchIOFalso({
  log: (l: string) => { saida.push(l) },
  responder: async (pergunta: string) => [`resposta para: ${pergunta}`],
})

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'hicode-submit-direto-'))
  mkdirSync(join(dir, 'runs'), { recursive: true })
  process.env.HICODE_CARDS_DIR = dir
  saida = []
})

async function entrar(texto: string): Promise<{ state: ReturnType<typeof newSession>; saida: string }> {
  const state = newSession('org/app')
  const r = handle(texto, state)
  const d = await dispatch(r.effect, r.state, io)
  return { state: d.state, saida: saida.join(' ') }
}

test('REGRESSAO: texto livre cria a tarefa e ja entra na fila, sem plano nem aprovacao', async () => {
  const antes = allCards().length
  const { state, saida: texto } = await entrar('remove o selo beta do header')
  expect(allCards().length).toBe(antes + 1)
  expect(allCards()[0]?.status).toBe('EXECUTING')
  expect(texto).toContain('criado')
  expect(texto).toContain('na fila')
  expect(texto).toContain(providerNameFor('implement'))
  expect(texto).not.toContain('enter aprova')
  expect(state.pendingPlan).toBe('')
  const criado = allCards()[0]?.id
  if (!criado) throw new Error('o card criado ficou sem id')
  expect(state.seguindo).toBe(criado)
})

test('/new-task cria direto, igual ao texto livre', async () => {
  const { saida: texto } = await entrar('/new-task remove o selo beta')
  expect(allCards().length).toBe(1)
  expect(allCards()[0]?.status).toBe('EXECUTING')
  expect(texto).toContain('na fila')
})

test('/new-task sem texto explica o uso em vez de criar card vazio', async () => {
  const r = handle('/new-task', newSession('org/app'))
  expect(r.effect.kind).toBe('error')
  expect(r.effect.text).toContain('/new-task')
})

test('/new-ask pergunta sem criar card', async () => {
  const antes = allCards().length
  const { saida: texto } = await entrar('/new-ask qual modelo o gate usa?')
  expect(allCards().length).toBe(antes)
  expect(texto).toContain('resposta para: qual modelo o gate usa?')
})

test('/new-ask sem pergunta nao chama a ia', () => {
  const r = handle('/new-ask', newSession('org/app'))
  expect(r.effect.kind).toBe('error')
})

test('daemon offline: o card entra na fila mas o aviso nao finge que ja esta rodando', async () => {
  const foraDoAr: string[] = []
  const ioOffline = dispatchIOFalso({
    log: (l: string) => { foraDoAr.push(l) },
    daemonOnline: () => false,
  })
  const state = newSession('org/app')
  const r = handle('remove o selo beta do header', state)
  await dispatch(r.effect, r.state, ioOffline)
  const texto = foraDoAr.join(' ')
  expect(texto).toContain('na fila')
  expect(texto).toContain('daemon offline')
  expect(texto).toContain('hii start')
  expect(texto).not.toContain(providerNameFor('implement'))
})

test('submit sem projeto avisa em vez de criar card orfao', async () => {
  const antes = allCards().length
  const r = handle('remove o selo', newSession(''))
  const d = await dispatch(r.effect, r.state, io)
  expect(saida.join(' ')).toContain('sem projeto')
  expect(allCards().length).toBe(antes)
  expect(d.state.seguindo).toBe('')
})
