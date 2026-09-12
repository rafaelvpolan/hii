import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-rm-fixo-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(join(BASE, 'cards'), { recursive: true })
const { confirmacaoDeRemocao } = await import('../../motor/mirante/cli/confirmacao-de-remocao.ts')
const { createCard } = await import('../../motor/cordel/store.ts')
const { dispatch } = await import('../../motor/mirante/despacho.ts')
const { handle, newSession } = await import('../../motor/mirante/sessao.ts')
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

test('REGRESSAO /rm: o plano de remocao vai para o bloco ACIMA do prompt, com os alvos e a dica de confirmar — nao para o log rolante', async () => {
  const a = createCard({ title: 'menu mobile', status: 'HALTED', repo: 'org/app', risk: 'low', cost_usd: '1.5000' }, '## Objetivo\nx\n')
  const b = createCard({ title: 'rodape', status: 'INBOX', repo: 'org/app', risk: 'low' }, '## Objetivo\ny\n')
  const log: string[] = []
  const io = { log: (l: string) => log.push(l), color: false, largura: () => 80, dim: (s: string) => s, daemonOnline: () => true, responder: () => Promise.resolve([]) }
  const r = handle(`/rm ${Number(a)} ${Number(b)}`, newSession('org/app'))
  const depois = await dispatch(r.effect, r.state, io as never)
  expect(depois.state.removendo, 'o estado arma a confirmacao com os alvos').toBe(`${a} ${b}`)
  expect(log.join('\n'), 'nada do plano no log rolante quando ha alvo').not.toContain('apagar 2 tarefas')

  const fixo = confirmacaoDeRemocao(depois.state.removendo, { color: false, width: 80 })
  const txt = fixo.join('\n')
  expect(txt).toContain('apagar 2 tarefas')
  expect(txt).toContain(`#${a}`)
  expect(txt).toContain('menu mobile')
  expect(txt).toContain(`#${b}`)
  expect(txt).toContain('US$1.50 ja gastos')
  expect(txt).toContain('enter confirma · n cancela')
  expect(fixo[0], 'sem linha vazia no topo do bloco fixo').not.toBe('')
  expect(confirmacaoDeRemocao('', { color: false, width: 80 })).toEqual([])
})

test('/rm sem alvo valido continua explicando no log e NAO arma confirmacao', async () => {
  const log: string[] = []
  const io = { log: (l: string) => log.push(l), color: false, largura: () => 80, dim: (s: string) => s, daemonOnline: () => true, responder: () => Promise.resolve([]) }
  const r = handle('/rm 999', newSession('org/app'))
  const depois = await dispatch(r.effect, r.state, io as never)
  expect(depois.state.removendo).toBe('')
  expect(log.join('\n')).toContain('#999 nao existe')
  expect(log.join('\n')).toContain('nada a apagar')
})
