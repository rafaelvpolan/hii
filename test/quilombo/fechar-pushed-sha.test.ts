import { TEMPO_COM_GIT_MS } from '../tempo-de-teste.ts'
import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, chmodSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { GateResult } from '../../motor/ciclo/crivo/gate.ts'
import type { FinishDeps } from '../../motor/quilombo/cartorio/fechar.ts'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-pushedsha-'))
// Rigor estrito muda o comportamento do fechamento de proposito (barra area
// nova sem comando de teste). Fixado aqui para o teste nao depender do env de
// quem roda a suite.
delete process.env.HII_RIGOR_ESTRITO
process.env.HII_CARDS_DIR = join(BASE, 'cards')
mkdirSync(process.env.HII_CARDS_DIR, { recursive: true })

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

process.env.HII_REPOS_FILE = join(BASE, 'repos.json')
writeFileSync(process.env.HII_REPOS_FILE, JSON.stringify([{ name: 'org/repo', path: clone, branch: 'main' }]))

const GATE_APROVADO: GateResult = { ok: true, verdict: 'APPROVED', reason: 'sem defeito real encontrado', criterio: '', questions: [], cost: 0.01, costMeasured: true, tokens: 100 }

const agenteFinish: FinishDeps = {
  runStep: (): never => { throw new Error('nao deveria chamar runStep — steps: nada nao roda nenhum passo') },
  runCodefoxGate: (): Promise<GateResult> => Promise.resolve(GATE_APROVADO),
}

const PR_FALSO = 'https://github.com/org/repo/pull/999'

const ghBinDir = join(BASE, 'bin-fake-gh')
mkdirSync(ghBinDir, { recursive: true })
const ghFalso = join(ghBinDir, 'gh')
writeFileSync(ghFalso, `#!/usr/bin/env bash\nif [ "$1" = "pr" ] && [ "$2" = "create" ]; then\n  echo "${PR_FALSO}"\n  exit 0\nfi\necho "gh-falso: comando nao suportado: $*" >&2\nexit 1\n`)
chmodSync(ghFalso, 0o755)
const pathOriginal = process.env.PATH ?? ''
process.env.PATH = `${ghBinDir}:${pathOriginal}`

const realGit = await import('../../motor/quilombo/git.ts')

const { createCard, readCard, patchCard } = await import('../../motor/cordel/store.ts')
const { handleFinish } = await import('../../motor/quilombo/cartorio/fechar.ts')

afterAll(() => {
  process.env.PATH = pathOriginal
  rmSync(BASE, { recursive: true, force: true })
})

let seq = 0

function worktreeParaTeste(): string {
  return join(BASE, `wt-${++seq}`)
}

function commitar(wt: string, arquivo: string, texto: string, mensagem: string): void {
  writeFileSync(join(wt, arquivo), texto)
  git(wt, ['add', '-A'])
  git(wt, ['-c', 'commit.gpgsign=false', 'commit', '-qm', mensagem])
}

test('REGRESSAO: pushed_sha gravado pelo push anterior DESTE card ancora o push seguinte via handleFinish real (nao so a primitiva de git)', async () => {
  const wt = worktreeParaTeste()
  const id = createCard({
    title: 'ajuste de round trip do pushed_sha',
    status: 'URL_OK',
    repo: 'org/repo',
    surface: 'none',
    clarified: 'true',
    steps: 'nada',
    slug: 'roundtrip',
    worktree: wt,
  }, '## Objetivo\nfazer o roundtrip do pushed_sha\n')
  const branch = `hicode/${id}-roundtrip`

  await realGit.ensureWorktree(clone, wt, branch, 'main')
  commitar(wt, 'mudanca1.txt', 'primeira tentativa\n', 'feat: primeira tentativa')

  await handleFinish(id, agenteFinish)
  const apos1 = readCard(id)
  expect(apos1?.fm.status).toBe('PR_OPEN')
  expect(apos1?.fm.pr_url).toBe(PR_FALSO)
  expect(apos1?.fm.cost_usd).toBe('0.0100')
  expect(apos1?.fm.tokens_total).toBe('100')
  const primeiroPushedSha = apos1?.fm.pushed_sha ?? ''
  expect(primeiroPushedSha).toHaveLength(40)
  expect(existsSync(wt)).toBe(false)

  await realGit.ensureWorktree(clone, wt, branch, 'main', { refazerDoZero: true })
  commitar(wt, 'mudanca2.txt', 'segunda tentativa (worktree recriado do zero em cima da base)\n', 'feat: segunda tentativa')
  patchCard(id, { status: 'URL_OK' }, 'retomado pelo humano (teste) — worktree foi recriado do zero pela reexecucao')

  await handleFinish(id, agenteFinish)
  const apos2 = readCard(id)
  expect(apos2?.fm.status).toBe('PR_OPEN')
  expect(apos2?.fm.cost_usd).toBe('0.0200')
  expect(apos2?.fm.tokens_total).toBe('200')
  const segundoPushedSha = apos2?.fm.pushed_sha ?? ''
  expect(segundoPushedSha).toHaveLength(40)
  expect(segundoPushedSha).not.toBe(primeiroPushedSha)

  const checkout = join(BASE, 'check-remoto')
  execFileSync('git', ['clone', '-q', '--branch', branch, origem, checkout])
  expect(existsSync(join(checkout, 'mudanca2.txt'))).toBe(true)
  expect(existsSync(join(checkout, 'mudanca1.txt'))).toBe(false)
  expect(git(checkout, ['rev-parse', 'HEAD'])).toBe(segundoPushedSha)
}, TEMPO_COM_GIT_MS)

test('fecho passivo preserva certificado antes de remover worktree; falha preserva PR e trabalho', async () => {
  const { planoOrquestrado } = await import('../fixtures/plano-orquestrado.ts')
  const { salvarPlano } = await import('../../motor/oswaldo/orquestracao/planos.ts')
  const { avaliarExecucao } = await import('../../motor/api/avaliacao.ts')
  writeFileSync(ghFalso, '#!/bin/sh\nif [ "$1" = pr ] && [ "$2" = list ]; then echo "[]"; exit 0; fi\nif [ "$1" = pr ] && [ "$2" = create ]; then\nif [ "$HII_TEST_DIRTY_PR" = 1 ]; then echo mudanca > depois-do-push.txt; fi\necho "' + PR_FALSO + '"; exit 0; fi\nexit 1\n')
  try {
    for (const cenario of ['normal', 'sujo', 'parada']) {
      const sujo = cenario === 'sujo'
      process.env.HII_TEST_DIRTY_PR = sujo ? '1' : '0'
      const wt = worktreeParaTeste()
      const id = createCard({ title: 'entrega passiva', status: 'URL_OK', repo: 'org/repo', surface: 'none',
        clarified: 'true', steps: 'nada', slug: 'entrega', worktree: wt, pipeline: 'auto', motor_modo: 'passivo' }, '## Objetivo\nentrega com prova\n')
      const p = salvarPlano({ ...planoOrquestrado(), id, sessaoId: id, repo: 'org/repo' }, 0, 'entrega')
      patchCard(id, { plano_revisao: '1', plano_hash: p.hash })
      await realGit.ensureWorktree(clone, wt, 'hicode/' + id + '-entrega', 'main')
      commitar(wt, 'entrega.txt', 'resultado\n', 'feat: entrega')
      await handleFinish(id, { ...agenteFinish, certificarEntrega: async (...args) => {
        const { certificarEntrega } = await import('../../motor/oswaldo/orquestracao/entrega.ts')
        const digest = await certificarEntrega(...args)
        if (cenario === 'parada') patchCard(id, { status: 'HALTED', halt_class: 'humano' })
        return digest
      } })
      const c = readCard(id)!
      expect(c.fm.pr_url).toBe(PR_FALSO)
      if (sujo || cenario === 'parada') {
        if (cenario === 'parada') expect(c.fm.halt_class).toBe('humano')
        expect(c.fm.status).toBe('HALTED')
        expect(existsSync(wt)).toBe(true)
        expect(c.fm.entrega_evidencia || '').toBe('')
      } else {
        expect(c.fm.status).toBe('PR_OPEN')
        expect(c.fm.entrega_evidencia).toHaveLength(64)
        expect(existsSync(wt)).toBe(false)
        const a = await avaliarExecucao(id, async () => ({ stdout: JSON.stringify({ url: PR_FALSO, state: 'OPEN', headRefOid: c.fm.pushed_sha, mergeCommit: null }), stderr: '', err: null }))
        expect(a.criteriosAprovados).toBe(true)
      }
    }
  } finally { delete process.env.HII_TEST_DIRTY_PR }
}, TEMPO_COM_GIT_MS)
