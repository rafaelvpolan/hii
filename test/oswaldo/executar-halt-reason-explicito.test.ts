import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ExecuteDeps } from '../../motor/oswaldo/executar.ts'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-exec-haltreason-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(process.env.HICODE_CARDS_DIR, { recursive: true })

const FANTASMA = join(BASE, 'repo-que-nao-existe')
process.env.HICODE_REPOS_FILE = join(BASE, 'repos.json')
writeFileSync(process.env.HICODE_REPOS_FILE, JSON.stringify([{ name: 'org/fantasma', path: FANTASMA, branch: 'main' }]))

const { createCard, readCard } = await import('../../motor/cordel/store.ts')
const { handleExecute } = await import('../../motor/oswaldo/executar.ts')

afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const naoRoda: ExecuteDeps = {
  implement: () => { throw new Error('o implement nao devia rodar num HALT precoce') },
  verifyVisual: () => { throw new Error('o verifyVisual nao devia rodar num HALT precoce') },
}

function motivoNoDiario(body: string): string {
  const linha = body.split('\n').find(l => l.includes('EXECUTING->HALTED ')) ?? ''
  return linha.split('EXECUTING->HALTED ')[1] ?? ''
}

test('custo ilegivel: halt_reason chega ao frontmatter e e o mesmo motivo que o diario conta', async () => {
  const id = createCard({ title: 'custo torto', status: 'EXECUTING', repo: 'org/fantasma', cost_usd: 'abc' }, '## Objetivo\np\n')
  await handleExecute(id, naoRoda)
  const c = readCard(id)
  expect(c?.fm.status).toBe('HALTED')
  expect(c?.fm.halt_class).toBe('orcamento')
  expect(c?.fm.halt_reason).toContain('nao e numero')
  expect(c?.fm.halt_reason).toBe(motivoNoDiario(c?.body ?? ''))
})

test('repo nao encontrado: halt_reason explicito com o caminho procurado', async () => {
  const id = createCard({ title: 'repo fantasma', status: 'EXECUTING', repo: 'org/fantasma', cost_usd: '0.0100' }, '## Objetivo\np\n')
  await handleExecute(id, naoRoda)
  const c = readCard(id)
  expect(c?.fm.status).toBe('HALTED')
  expect(c?.fm.halt_class).toBe('terminal')
  expect(c?.fm.halt_reason).toBe(`repo nao encontrado: ${FANTASMA}`)
})
