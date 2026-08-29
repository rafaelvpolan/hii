import { test, expect, beforeEach } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { newSession } from '../../motor/mirante/sessao.ts'
import { dispatchIOFalso } from '../fixtures/dispatch-io-falso.ts'

let saida: string[] = []

const io = dispatchIOFalso({
  log: (l: string) => { saida.push(l) },
  plano: async (id: string) => [`plano do #${id}`],
  responder: async (pergunta: string) => [`resposta para: ${pergunta}`],
})

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'hicode-disp-'))
  mkdirSync(join(dir, 'runs'), { recursive: true })
  process.env.HICODE_CARDS_DIR = dir
  saida = []
})

test('nenhum efeito da sessao pode sumir em silencio', async () => {
  const { dispatch } = await import('../../motor/mirante/despacho.ts')
  const kinds = ['submit', 'approve-plan', 'halt', 'plan',
    'help', 'error', 'approve-url', 'reject-url', 'answer', 'rm', 'confirm-rm']
  for (const kind of kinds) {
    saida = []
    const r = await dispatch({ kind } as never, newSession('org/app'), io)
    if (kind === 'submit') { expect(r.tratado).toBe(true); continue }
    expect(r.tratado).toBe(true)
    expect(saida.join(' ')).not.toContain('sem tratamento')
  }
})

test('efeito desconhecido grita em vez de sumir', async () => {
  const { dispatch } = await import('../../motor/mirante/despacho.ts')
  await dispatch({ kind: 'inventado' } as never, newSession('org/app'), io)
  expect(saida.join(' ')).toContain('bug do hii')
})

test('quit e board ficam para quem chamou; o resto o despachante trata', async () => {
  const { dispatch } = await import('../../motor/mirante/despacho.ts')
  for (const kind of ['quit', 'historico']) {
    expect((await dispatch({ kind } as never, newSession(''), io)).tratado).toBe(false)
  }
  expect((await dispatch({ kind: 'reopen-repo' } as never, newSession(''), io)).tratado).toBe(true)
})
