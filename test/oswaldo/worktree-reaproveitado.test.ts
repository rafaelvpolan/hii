import { TEMPO_COM_GIT_MS } from '../tempo-de-teste.ts'
import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ImplementResult } from '../../motor/cordel/index.ts'
import type { ExecuteDeps } from '../../motor/oswaldo/executar.ts'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-wt-reuso-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(process.env.HICODE_CARDS_DIR, { recursive: true })

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

const origem = join(BASE, 'origem.git')
const semente = join(BASE, 'semente')
const clone = join(BASE, 'clone')
mkdirSync(semente, { recursive: true })
execFileSync('git', ['init', '-q', '--bare', origem])
git(semente, ['init', '-q', '.'])
git(semente, ['config', 'user.email', 't@t'])
git(semente, ['config', 'user.name', 't'])
writeFileSync(join(semente, 'a.txt'), 'um\n')
git(semente, ['add', '-A'])
git(semente, ['commit', '-qm', 'primeiro'])
git(semente, ['branch', '-M', 'main'])
git(semente, ['remote', 'add', 'origin', origem])
git(semente, ['push', '-q', '-u', 'origin', 'main'])
execFileSync('git', ['--git-dir', origem, 'symbolic-ref', 'HEAD', 'refs/heads/main'])
execFileSync('git', ['clone', '-q', origem, clone])
git(clone, ['config', 'user.email', 't@t'])
git(clone, ['config', 'user.name', 't'])

process.env.HICODE_REPOS_FILE = join(BASE, 'repos.json')
writeFileSync(process.env.HICODE_REPOS_FILE, JSON.stringify([{ name: 'org/repo', path: clone, branch: 'main' }]))
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const { createCard, readCard, patchCard } = await import('../../motor/cordel/store.ts')
const { handleExecute } = await import('../../motor/oswaldo/executar.ts')

const USO = { tokens_in: 10, tokens_out: 20, tokens_cache_create: 0, tokens_cache_read: 0 }

// O agente COMMITA o que fez, como o motor faz de verdade no fim do implement.
function implementQueCommita(marca: string): ExecuteDeps {
  return {
    implement: (_card, wt): Promise<ImplementResult> => {
      writeFileSync(join(wt, `${marca}.txt`), `${marca}\n`)
      git(wt, ['add', '-A'])
      git(wt, ['commit', '-qm', `trabalho ${marca}`])
      return Promise.resolve({ ok: true, resultText: 'feito', fullText: 'feito', cost: '0.5000', usage: USO })
    },
    verifyVisual: (): Promise<never> => Promise.reject(new Error('nao deveria chegar aqui')),
  }
}

let seq = 0
function card(): string {
  return createCard({
    title: 'trabalho a preservar', status: 'EXECUTING', repo: 'org/repo',
    surface: 'none', clarified: 'true', worktree: join(BASE, `wt-${++seq}`),
  }, '## Objetivo\nfazer algo\n')
}

// O reuso exigia `spec_done === 'true'`: TODA retomada humana caia no caminho que
// APAGA o worktree e recria a branch de origin/base. O trabalho ja commitado ia
// junto, e o motor pagava de novo cada passo para chegar ao mesmo lugar — foi o que
// fez a retomada do card 001 custar US$0,75 por ENTER.
test('REGRESSAO: retomar PRESERVA o trabalho ja commitado, em vez de refazer do zero', async () => {
  const id = card()
  await handleExecute(id, implementQueCommita('primeira'))
  const wt = String(readCard(id)?.fm.worktree ?? '')
  expect(existsSync(join(wt, 'primeira.txt')), 'a primeira rodada trabalhou').toBe(true)

  // Retomada: o humano poe o card de volta em EXECUTING.
  patchCard(id, { status: 'EXECUTING' })
  await handleExecute(id, implementQueCommita('segunda'))

  expect(existsSync(join(wt, 'primeira.txt')), 'o trabalho da rodada anterior tem de sobreviver').toBe(true)
  expect(existsSync(join(wt, 'segunda.txt')), 'e a rodada nova soma').toBe(true)
  expect(readCard(id)?.body ?? '', 'e o diario diz que reaproveitou').toContain('worktree reaproveitado')
}, TEMPO_COM_GIT_MS)

// "Refaz do zero" dependia justamente da destruicao. Com o reuso virando padrao,
// ele passou a pedir explicitamente — senao rejeitar a url deixaria de refazer.
test('refazer do zero, quando PEDIDO, continua apagando o worktree', async () => {
  const id = card()
  await handleExecute(id, implementQueCommita('antiga'))
  const wt = String(readCard(id)?.fm.worktree ?? '')
  expect(existsSync(join(wt, 'antiga.txt'))).toBe(true)

  patchCard(id, { status: 'EXECUTING', refazer: 'true' })
  await handleExecute(id, implementQueCommita('nova'))

  expect(existsSync(join(wt, 'antiga.txt')), 'refazer do zero descarta mesmo').toBe(false)
  expect(existsSync(join(wt, 'nova.txt'))).toBe(true)
  expect(readCard(id)?.fm.refazer, 'a marca e consumida — nao refaz para sempre').toBe('')
}, TEMPO_COM_GIT_MS)

test('rejeitar a url SEM motivo marca refazer; COM motivo nao marca', async () => {
  const { rejectUrl } = await import('../../motor/mirante/acoes.ts')
  const semMotivo = card()
  patchCard(semMotivo, { status: 'URL', url: 'http://x' })
  rejectUrl(semMotivo, '')
  expect(readCard(semMotivo)?.fm.refazer, 'sem dizer o que ajustar = do zero').toBe('true')

  const comMotivo = card()
  const wt = join(BASE, `wt-com-motivo`)
  mkdirSync(join(wt, '.git'), { recursive: true })
  patchCard(comMotivo, { status: 'URL', url: 'http://x', worktree: wt })
  rejectUrl(comMotivo, 'o azul ficou escuro demais')
  expect(readCard(comMotivo)?.fm.refazer ?? '', 'com ajuste pedido, o trabalho continua').toBe('')
}, TEMPO_COM_GIT_MS)

// Sem worktree nao ha o que reaproveitar — e criar do zero e o certo, nao um erro.
test('primeira execucao cria o worktree normalmente', async () => {
  const id = card()
  await handleExecute(id, implementQueCommita('unica'))
  expect(readCard(id)?.body ?? '').toContain('branch criada de origin/main')
}, TEMPO_COM_GIT_MS)
