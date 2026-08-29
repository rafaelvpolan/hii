// REGRESSAO do card #006 ("resolva o conflito ... /pull/25"): o crivo parou de
// conseguir LER o diff e o card caiu em HALTED a cada retomada.
//
// `stageAll` mandava sempre `git add -A -- . ':!node_modules'`. O exclude existe
// porque o motor liga o node_modules do worktree por SYMLINK e o padrao
// `node_modules/` do .gitignore (com barra) so casa diretorio de verdade — sem ele o
// symlink ia pro commit. Mas quando algum passo roda `npm install` DENTRO do
// worktree, node_modules vira diretorio de verdade, o git passa a ignora-lo, e
// pathspec negativo + caminho ignorado presente faz o `git add` sair 1 com "The
// following paths are ignored by one of your .gitignore files". Falha
// deterministica: toda retomada do card morria no mesmo ponto.
//
// Estes testes rodam git de verdade — texto-fonte nao provaria execucao.
import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { stageAll } from '../../motor/quilombo/git.ts'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-stageall-'))
let seq = 0

afterAll(() => rmSync(BASE, { recursive: true, force: true }))

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function repoComGitignore(linhas: string): string {
  const repo = join(BASE, `repo-${++seq}`)
  mkdirSync(repo, { recursive: true })
  git(repo, ['init', '-q', '.'])
  git(repo, ['config', 'user.email', 't@t'])
  git(repo, ['config', 'user.name', 't'])
  writeFileSync(join(repo, '.gitignore'), linhas)
  writeFileSync(join(repo, 'app.ts'), 'export const a = 1\n')
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-qm', 'primeiro'])
  return repo
}

function indice(repo: string): string[] {
  return git(repo, ['diff', '--cached', '--name-only', 'HEAD']).split('\n').filter(Boolean)
}

test('REGRESSAO node_modules de verdade e ignorado: stageAll nao falha e entrega o diff', async () => {
  const repo = repoComGitignore('node_modules/\n')
  mkdirSync(join(repo, 'node_modules', 'vitest'), { recursive: true })
  writeFileSync(join(repo, 'node_modules', 'vitest', 'index.js'), 'module.exports = {}\n')
  writeFileSync(join(repo, 'app.ts'), 'export const a = 2\n')

  const r = await stageAll(repo)

  expect(r.err).toBe(null)
  expect(indice(repo)).toEqual(['app.ts'])
})

test('node_modules por symlink nao entra no indice — o exclude continua fazendo o servico', async () => {
  const compartilhado = join(BASE, `nm-${++seq}`)
  mkdirSync(compartilhado, { recursive: true })
  writeFileSync(join(compartilhado, 'x.js'), 'module.exports = {}\n')
  const repo = repoComGitignore('node_modules/\n')
  symlinkSync(compartilhado, join(repo, 'node_modules'), 'dir')
  writeFileSync(join(repo, 'app.ts'), 'export const a = 3\n')

  const r = await stageAll(repo)

  expect(r.err).toBe(null)
  expect(indice(repo)).toEqual(['app.ts'])
})

test('alvo que NAO ignora node_modules tambem nao commita a pasta', async () => {
  const repo = repoComGitignore('dist/\n')
  mkdirSync(join(repo, 'node_modules', 'left-pad'), { recursive: true })
  writeFileSync(join(repo, 'node_modules', 'left-pad', 'index.js'), 'module.exports = {}\n')
  writeFileSync(join(repo, 'app.ts'), 'export const a = 4\n')

  const r = await stageAll(repo)

  expect(r.err).toBe(null)
  expect(indice(repo)).toEqual(['app.ts'])
})
