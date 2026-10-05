import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { newSession, handle } from '../../motor/mirante/sessao.ts'
import { dispatchIOFalso } from '../fixtures/dispatch-io-falso.ts'
const dir = mkdtempSync(join(tmpdir(), 'hii-pacote-tui-'))
process.env.HII_CARDS_DIR = dir
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const { createCard } = await import('../../motor/cordel/store.ts')
const { arquivoDoPacote } = await import('../../motor/niemeyer/lucio/aprovacao-do-pacote.ts')
const { dispatch } = await import('../../motor/mirante/despacho.ts')
test('o comando de pacote da TUI mostra prompt persistido sem executar nem aprovar', async () => {
  const id = createCard({ title: 'revisar prompt', repo: 'fixture/app', status: 'CLARIFY', pacote_status: 'aguardando' }, 'Objetivo')
  mkdirSync(join(dir, 'pacotes'))
  writeFileSync(arquivoDoPacote(id), '# Pacote\nPrompt completo revisavel\n')
  const linhas: string[] = []
  const state = newSession('fixture/app')
  const efeito = handle('/pacote ' + id, state).effect
  expect(efeito.kind).toBe('pacote')
  await dispatch(efeito, state, dispatchIOFalso({ log: l => linhas.push(l) }))
  expect(linhas.join('\n')).toContain('Prompt completo revisavel')
  const { readCard } = await import('../../motor/cordel/store.ts')
  expect(readCard(id)?.fm.status).toBe('CLARIFY')
})
