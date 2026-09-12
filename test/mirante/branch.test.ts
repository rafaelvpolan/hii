import { test, expect } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { arquivoHead, branchAtual, branchDoHead } from '../../motor/mirante/cli/branch.ts'
import { etiquetaDoProjeto } from '../../motor/mirante/render/projeto.ts'
import { stripAnsi } from '../../motor/mirante/tui/layout.ts'

function repoFalso(head: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'hii-branch-'))
  mkdirSync(join(dir, '.git'))
  writeFileSync(join(dir, '.git', 'HEAD'), head)
  return dir
}

test('branchDoHead le a ref simbolica e encurta o sha solto', () => {
  expect(branchDoHead('ref: refs/heads/feat/tui-visual\n')).toBe('feat/tui-visual')
  expect(branchDoHead('a1b2c3d4e5f60718293a4b5c6d7e8f9012345678\n')).toBe('a1b2c3d')
  expect(branchDoHead('')).toBe('')
})

test('branchAtual le o HEAD do repo e acompanha a troca de branch', () => {
  const dir = repoFalso('ref: refs/heads/main\n')
  try {
    expect(branchAtual(dir)).toBe('main')
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/feat/outra\n')
    expect(branchAtual(dir)).toBe('feat/outra')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('branchAtual segue o gitdir de um worktree', () => {
  const principal = repoFalso('ref: refs/heads/main\n')
  const wt = mkdtempSync(join(tmpdir(), 'hii-wt-'))
  try {
    const gitdir = join(principal, '.git', 'worktrees', 'wt')
    mkdirSync(gitdir, { recursive: true })
    writeFileSync(join(gitdir, 'HEAD'), 'ref: refs/heads/hii/004-selo\n')
    writeFileSync(join(wt, '.git'), `gitdir: ${gitdir}\n`)
    expect(arquivoHead(wt)).toBe(join(gitdir, 'HEAD'))
    expect(branchAtual(wt)).toBe('hii/004-selo')
  } finally {
    rmSync(principal, { recursive: true, force: true })
    rmSync(wt, { recursive: true, force: true })
  }
})

test('fora de um repo git a branch e vazia, sem lancar', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hii-nogit-'))
  try {
    expect(branchAtual(dir)).toBe('')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a etiqueta do projeto mostra a branch entre o nome e o detalhe', () => {
  const t = stripAnsi(etiquetaDoProjeto('org/site', { branch: 'main', detalhe: 'tarefa #22' }))
  expect(t).toContain('⎇ main')
  expect(t.indexOf('site')).toBeLessThan(t.indexOf('⎇ main'))
  expect(t.indexOf('⎇ main')).toBeLessThan(t.indexOf('tarefa #22'))
  expect(stripAnsi(etiquetaDoProjeto('org/site', { branch: '' }))).not.toContain('⎇')
})
