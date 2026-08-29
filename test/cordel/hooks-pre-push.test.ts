import { test, expect, beforeEach, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installPrePush, uninstallPrePush } from '../../motor/cordel/alicerce/hooks.ts'

const criados: string[] = []
let repo = ''
let source = ''

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'hicode-hooks-'))
  criados.push(base)
  repo = join(base, 'repo')
  mkdirSync(repo, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: repo })
  source = join(base, 'pre-push-fonte')
  writeFileSync(source, '#!/bin/sh\necho hii gate\n')
})

afterAll(() => { for (const d of criados) rmSync(d, { recursive: true, force: true }) })

function hookPath(): string {
  return join(repo, '.git', 'hooks', 'pre-push')
}

test('instala quando nao ha hook nenhum', () => {
  const r = installPrePush(repo, source)
  expect(r.ok).toBe(true)
  expect(r.backup).toBe('')
  expect(readFileSync(hookPath(), 'utf8')).toContain('hii gate')
})

test('REGRESSAO hook de outra ferramenta NAO e sobrescrito sem backup', () => {
  mkdirSync(join(repo, '.git', 'hooks'), { recursive: true })
  writeFileSync(hookPath(), '#!/bin/sh\necho husky\n')
  const r = installPrePush(repo, source)
  expect(r.ok).toBe(true)
  expect(r.backup).toBeTruthy()
  expect(readFileSync(r.backup, 'utf8')).toContain('husky')
  expect(readFileSync(hookPath(), 'utf8')).toContain('hii gate')
})

test('REGRESSAO uninstall NAO remove hook que o hii nao instalou', () => {
  mkdirSync(join(repo, '.git', 'hooks'), { recursive: true })
  writeFileSync(hookPath(), '#!/bin/sh\necho husky\n')
  const r = uninstallPrePush(repo, source)
  expect(r.ok).toBe(false)
  expect(r.motivo).toContain('nao foi instalado pelo hii')
  expect(readFileSync(hookPath(), 'utf8')).toContain('husky')
})

test('uninstall restaura o hook que estava la antes', () => {
  mkdirSync(join(repo, '.git', 'hooks'), { recursive: true })
  writeFileSync(hookPath(), '#!/bin/sh\necho husky\n')
  installPrePush(repo, source)
  const r = uninstallPrePush(repo, source)
  expect(r.ok).toBe(true)
  expect(r.restaurado).toBe(hookPath())
  expect(readFileSync(hookPath(), 'utf8')).toContain('husky')
})

test('instalar duas vezes seguidas nao gera backup do proprio hook do hii', () => {
  installPrePush(repo, source)
  const r = installPrePush(repo, source)
  expect(r.ok).toBe(true)
  expect(r.backup).toBe('')
  expect(existsSync(hookPath() + '.antes-do-hii')).toBe(false)
})
