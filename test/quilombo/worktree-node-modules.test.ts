import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, lstatSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hii-wt-deps-'))
process.env.HII_CARDS_DIR = join(BASE, 'cards')
mkdirSync(process.env.HII_CARDS_DIR, { recursive: true })

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

const origem = join(BASE, 'origem.git')
const clone = join(BASE, 'clone')
execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origem])
mkdirSync(clone)
git(clone, ['init', '-q', '-b', 'main', '.'])
git(clone, ['config', 'user.email', 't@t'])
git(clone, ['config', 'user.name', 't'])
writeFileSync(join(clone, '.gitignore'), 'node_modules/\n')
writeFileSync(join(clone, 'a.txt'), 'um\n')
git(clone, ['add', '-A'])
git(clone, ['commit', '-qm', 'primeiro'])
git(clone, ['remote', 'add', 'origin', origem])
git(clone, ['push', '-q', '-u', 'origin', 'main'])
mkdirSync(join(clone, 'node_modules', 'pacote'), { recursive: true })

const { ensureWorktree } = await import('../../motor/quilombo/git.ts')

afterAll(() => rmSync(BASE, { recursive: true, force: true }))

test('dependencias ligadas no worktree nao aparecem como alteracao nao commitada', async () => {
  const wt = join(BASE, 'wt')
  await ensureWorktree(clone, wt, 'hicode/1-deps', 'main')
  expect(lstatSync(join(wt, 'node_modules')).isSymbolicLink()).toBe(true)
  expect(git(wt, ['status', '--porcelain', '--untracked-files=all'])).toBe('')
  expect(git(wt, ['ls-files', '--others', '--exclude-standard'])).toBe('')
  await ensureWorktree(clone, wt, 'hicode/1-deps', 'main')
  const exclude = readFileSync(join(clone, '.git', 'info', 'exclude'), 'utf8')
  expect(exclude.split('\n').filter(l => l === '/node_modules').length).toBe(1)
})
