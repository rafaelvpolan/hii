// createCard: alocacao de id e escrita no MESMO lock, com flag exclusiva `wx`.
// Antes, `nextId()` rodava fora de qualquer trava e dois processos (TUI + CLI +
// sync) liam o mesmo max: um card SOBRESCREVIA o outro, sem rastro — a unica
// escrita nao protegida num modulo cujo caminho de update usa withFileLock +
// writeFileAtomic. Este teste sobe dois processos REAIS criando cards ao mesmo
// tempo e prova que todo id sai unico e todo arquivo sobrevive.
import { test, expect, afterAll, rodar } from '../apoio/runner.ts'
import { mkdtempSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const CARDS = mkdtempSync(join(tmpdir(), 'hicode-criacao-'))
process.env.HICODE_CARDS_DIR = CARDS

const { createCard, readCard } = await import('../../motor/cordel/store.ts')

afterAll(() => rmSync(CARDS, { recursive: true, force: true }))

function arquivosDeCard(): number {
  return readdirSync(CARDS).filter(f => f.endsWith('.md')).length
}

test('criacao sequencial: ids distintos e os dois cards sobrevivem', () => {
  const a = createCard({ title: 'primeiro', status: 'READY', repo: 'org/repo' }, '## Objetivo\na\n')
  const b = createCard({ title: 'segundo', status: 'READY', repo: 'org/repo' }, '## Objetivo\nb\n')
  expect(a).not.toBe(b)
  expect(readCard(a)?.fm.title).toBe('primeiro')
  expect(readCard(b)?.fm.title).toBe('segundo')
})

test('criacao concorrente em dois processos: 24 pedidos, 24 ids unicos, 24 arquivos novos', async () => {
  const fixture = fileURLToPath(new URL('../fixtures/cria-cards.ts', import.meta.url))
  const env = { ...process.env, HICODE_CARDS_DIR: CARDS }
  const antes = arquivosDeCard()
  const a = rodar([process.execPath, fixture, '12'], { env })
  const b = rodar([process.execPath, fixture, '12'], { env })
  const [ra, rb] = await Promise.all([a.saida(), b.saida()])
  expect(ra.code, ra.stderr).toBe(0)
  expect(rb.code, rb.stderr).toBe(0)
  const ids = `${ra.stdout}${rb.stdout}`.split('\n').map(l => l.trim()).filter(Boolean)
  expect(ids.length).toBe(24)
  expect(new Set(ids).size).toBe(24)
  expect(arquivosDeCard() - antes).toBe(24)
}, 60000)
