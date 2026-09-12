import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { CorrectDeps } from '../../motor/ciclo/corrigir.ts'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-correct-haltreason-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(process.env.HICODE_CARDS_DIR, { recursive: true })

const { createCard, readCard } = await import('../../motor/cordel/store.ts')
const { handleCorrect } = await import('../../motor/ciclo/corrigir.ts')

afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const naoRoda: CorrectDeps = {
  implement: () => { throw new Error('o implement nao devia rodar num HALT precoce') },
  runStep: () => { throw new Error('o runStep nao devia rodar num HALT precoce') },
}

function motivoNoDiario(body: string): string {
  const linha = body.split('\n').find(l => l.includes('CORRECTING->HALTED ')) ?? ''
  return linha.split('CORRECTING->HALTED ')[1] ?? ''
}

test('custo ilegivel: halt_reason chega ao frontmatter e e o mesmo motivo que o diario conta', async () => {
  const id = createCard({ title: 'custo torto', status: 'CORRECTING', repo: 'org/repo', cost_usd: 'abc', correction: 'x' }, '## Objetivo\np\n')
  await handleCorrect(id, naoRoda)
  const c = readCard(id)
  expect(c?.fm.status).toBe('HALTED')
  expect(c?.fm.halt_class).toBe('orcamento')
  expect(c?.fm.halt_reason).toContain('nao e numero')
  expect(c?.fm.halt_reason).toBe(motivoNoDiario(c?.body ?? ''))
})

test('worktree invalido: halt_reason explicito, sem depender do formato da linha de diario', async () => {
  const id = createCard({ title: 'sem worktree', status: 'CORRECTING', repo: 'org/repo', cost_usd: '0.0100', correction: 'x', worktree: '' }, '## Objetivo\np\n')
  await handleCorrect(id, naoRoda)
  const c = readCard(id)
  expect(c?.fm.status).toBe('HALTED')
  expect(c?.fm.halt_class).toBe('terminal')
  expect(c?.fm.halt_reason).toBe('correção sem worktree valido')
  expect(c?.fm.correction).toBe('')
})
