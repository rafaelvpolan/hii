// Onda 1-B do raio-x: eval_score deixou de ser chamada paga sem leitor. Score no
// limiar (default 1) manda o card UMA vez para CORRECTING com a instrucao montada
// das notes — o caminho redoUrl ja existia; a marca eval_gate=usado impede loop e
// a reincidencia segue ao humano com aviso (fail-open). E o unico checkpoint
// automatico ANTES de o humano abrir a URL; o crivo so roda depois de URL_OK.
import { TEMPO_COM_GIT_MS } from '../tempo-de-teste.ts'
import { test, expect, afterAll, beforeEach } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ImplementResult, Fields } from '../../motor/cordel/index.ts'
import type { ExecuteDeps } from '../../motor/oswaldo/executar.ts'
import type { EvalResult } from '../../motor/ciclo/crivo/avaliar.ts'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-evalgate-'))
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

const IMPLEMENT_RESULT: ImplementResult = {
  ok: true,
  resultText: 'mudou algo',
  fullText: 'mudou algo',
  cost: '0.0100',
  usage: { tokens_in: 5, tokens_out: 5, tokens_cache_create: 0, tokens_cache_read: 0 },
}

const { createCard, readCard } = await import('../../motor/cordel/store.ts')
const { handleExecute } = await import('../../motor/oswaldo/executar.ts')
const { decisaoDoEval } = await import('../../motor/ciclo/crivo/avaliar.ts')
const { evalMin } = await import('../../motor/cordel/alicerce/config.ts')

function depsComEval(e: Partial<EvalResult>): ExecuteDeps {
  return {
    implement: (): Promise<ImplementResult> => Promise.resolve(IMPLEMENT_RESULT),
    verifyVisual: (): Promise<never> => Promise.reject(new Error('nao deveria chamar verifyVisual')),
    avaliar: (): Promise<EvalResult> => Promise.resolve({ score: 3, meets: true, notes: 'ok', cost: 0.002, tokens: 12, ...e }),
  }
}

beforeEach(() => {
  delete process.env.HICODE_EVAL_MIN
})

afterAll(() => rmSync(BASE, { recursive: true, force: true }))

let seq = 0

function cardVisual(extra: Fields = {}): string {
  return createCard({
    title: 'botao novo na home',
    status: 'EXECUTING',
    repo: 'org/repo',
    surface: 'visual',
    clarified: 'true',
    worktree: join(BASE, `wt-${++seq}`),
    ...extra,
  }, '## Objetivo\nbotao novo na home\n')
}

test('score no limiar manda o card UMA vez para CORRECTING com a instrucao montada das notes', async () => {
  const id = cardVisual()
  await handleExecute(id, depsComEval({ score: 0, meets: false, notes: 'diff nao cria botao nenhum' }))
  const fm = readCard(id)?.fm
  expect(fm?.status).toBe('CORRECTING')
  expect(fm?.eval_gate).toBe('usado')
  expect(fm?.eval_score).toBe('0')
  expect(fm?.correction).toContain('diff nao cria botao nenhum')
  expect(fm?.correction).toContain('botao novo na home')
}, TEMPO_COM_GIT_MS)

test('reincidencia NAO loopa: com eval_gate ja usado, score baixo segue ao humano com aviso', async () => {
  const id = cardVisual({ eval_gate: 'usado' })
  await handleExecute(id, depsComEval({ score: 1, meets: false, notes: 'continua sem botao' }))
  const card = readCard(id)
  expect(card?.fm.status).toBe('URL')
  expect(card?.fm.eval_score).toBe('1')
  expect(card?.body).toContain('refacao automatica ja usada')
}, TEMPO_COM_GIT_MS)

test('score acima do limiar segue direto ao humano, sem desvio e sem correction', async () => {
  const id = cardVisual()
  await handleExecute(id, depsComEval({ score: 4, meets: true, notes: 'botao presente' }))
  const fm = readCard(id)?.fm
  expect(fm?.status).toBe('URL')
  expect(fm?.eval_score).toBe('4')
  expect(String(fm?.correction ?? '')).toBe('')
}, TEMPO_COM_GIT_MS)

test('decisaoDoEval: limiar, marca de uso unico e eval-que-nao-rodou', () => {
  const e = (score: number): EvalResult => ({ score, meets: false, notes: 'n', cost: 0, tokens: 0 })
  expect(decisaoDoEval(e(2), {}, 1, 'obj').acao).toBe('nada')
  expect(decisaoDoEval(e(1), {}, 1, 'obj').acao).toBe('corrigir')
  expect(decisaoDoEval(e(1), {}, 1, 'obj').instrucao).toContain('obj')
  expect(decisaoDoEval(e(0), { eval_gate: 'usado' }, 1, 'obj').acao).toBe('avisar')
  expect(decisaoDoEval(e(-1), {}, 1, 'obj').acao).toBe('nada')
  expect(decisaoDoEval(e(0), {}, -1, 'obj').acao).toBe('nada')
})

test('evalMin: default 1, numero da env vale, e "off" desliga so o gate', () => {
  expect(evalMin()).toBe(1)
  process.env.HICODE_EVAL_MIN = '2'
  expect(evalMin()).toBe(2)
  process.env.HICODE_EVAL_MIN = 'off'
  expect(evalMin()).toBe(-1)
})
