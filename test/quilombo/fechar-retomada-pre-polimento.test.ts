import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { FinishDeps } from '../../motor/quilombo/cartorio/fechar.ts'

const BASE = mkdtempSync(join(tmpdir(), 'hii-retomada-pre-polimento-'))
process.env.HII_CARDS_DIR = join(BASE, 'cards')
mkdirSync(process.env.HII_CARDS_DIR, { recursive: true })

function git(dir: string, args: string[]): void {
  execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
}

const origem = join(BASE, 'origem.git')
const clone = join(BASE, 'clone')
execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origem])
mkdirSync(clone)
git(clone, ['init', '-q', '-b', 'main', '.'])
git(clone, ['config', 'user.email', 't@t'])
git(clone, ['config', 'user.name', 't'])
writeFileSync(join(clone, 'a.txt'), 'um\n')
git(clone, ['add', '-A'])
git(clone, ['commit', '-qm', 'primeiro'])
git(clone, ['remote', 'add', 'origin', origem])
git(clone, ['push', '-q', '-u', 'origin', 'main'])
git(clone, ['remote', 'set-url', '--push', 'origin', 'no-push://bloqueado'])

process.env.HII_REPOS_FILE = join(BASE, 'repos.json')
writeFileSync(process.env.HII_REPOS_FILE, JSON.stringify([{ name: 'org/repo', path: clone, branch: 'main' }]))

const { createCard, readCard } = await import('../../motor/cordel/store.ts')
const { handleFinish } = await import('../../motor/quilombo/cartorio/fechar.ts')

const semAgente: FinishDeps = {
  runStep: (): never => { throw new Error('nenhum passo pago pode rodar antes do preflight') },
  runCodefoxGate: (): never => { throw new Error('nenhum gate pode rodar antes do preflight') },
}

afterAll(() => rmSync(BASE, { recursive: true, force: true }))

test('push recusado no preflight para a tarefa e a retomada volta ao fechamento, nao a implementacao', async () => {
  const id = createCard({ title: 'faq', status: 'URL_OK', repo: 'org/repo', worktree: clone, cost_usd: '0.40' }, '## Objetivo\nfaq\n')
  await handleFinish(id, semAgente)
  const fm = readCard(id)?.fm
  expect(fm?.status).toBe('HALTED')
  expect(fm?.retomar_em).toBe('URL_OK')
})

test('orcamento estourado antes do polimento tambem retoma no fechamento', async () => {
  const id = createCard({ title: 'faq caro', status: 'URL_OK', repo: 'org/repo', worktree: clone, cost_usd: '99999' }, '## Objetivo\nfaq\n')
  await handleFinish(id, semAgente)
  const fm = readCard(id)?.fm
  expect(fm?.status).toBe('HALTED')
  expect(fm?.halt_class).toBe('orcamento')
  expect(fm?.retomar_em).toBe('URL_OK')
})
