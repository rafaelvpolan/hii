import { TEMPO_COM_GIT_MS } from '../tempo-de-teste.ts'
import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ImplementResult } from '../../motor/cordel/index.ts'
import type { CorrectDeps } from '../../motor/ciclo/corrigir.ts'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-correctwait-'))
// Rigor estrito muda o comportamento do fechamento de proposito (barra area
// nova sem comando de teste). Fixado aqui para o teste nao depender do env de
// quem roda a suite.
delete process.env.HICODE_RIGOR_ESTRITO
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(process.env.HICODE_CARDS_DIR, { recursive: true })

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

const origem = join(BASE, 'origem.git')
const semente = join(BASE, 'semente')
const wt = join(BASE, 'wt')
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
execFileSync('git', ['clone', '-q', origem, wt])
git(wt, ['config', 'user.email', 't@t'])
git(wt, ['config', 'user.name', 't'])

process.env.HICODE_REPOS_FILE = join(BASE, 'repos.json')
writeFileSync(process.env.HICODE_REPOS_FILE, JSON.stringify([{ name: 'org/repo', path: wt, branch: 'main' }]))

const SUCESSO: ImplementResult = { ok: true, resultText: 'refeito', fullText: 'refeito', cost: '0.0500', usage: { tokens_in: 10, tokens_out: 10, tokens_cache_create: 0, tokens_cache_read: 0 } }

const { runStep } = await import('../../motor/ciclo/agente.ts')
const { createCard, readCard } = await import('../../motor/cordel/store.ts')
const { handleCorrect } = await import('../../motor/ciclo/corrigir.ts')

const agente: CorrectDeps = {
  implement: (): Promise<ImplementResult> => Promise.resolve(SUCESSO),
  runStep,
}

afterAll(() => rmSync(BASE, { recursive: true, force: true }))

test('REGRESSAO: correcao bem-sucedida limpa wait_attempts residual de um incidente ja recuperado', async () => {
  const id = createCard({
    title: 'algo rejeitado',
    status: 'CORRECTING',
    repo: 'org/repo',
    surface: 'visual',
    worktree: wt,
    correction: 'refaca isso',
    wait_attempts: '3',
  }, '## Objetivo\nalgo\n')

  await handleCorrect(id, agente)
  const c = readCard(id)
  expect(c?.fm.status).toBe('URL')
  expect(c?.fm.wait_attempts).toBe('')
}, TEMPO_COM_GIT_MS)

// O card 001 em producao provou o defeito: cost_usd parado em 2.2684 enquanto o
// diario registrava "custo $1.5380 · 92122 tokens" de uma correcao ja executada.
// Cinco portoes de orcamento leem esse campo, entao todos decidiam sobre numero
// velho. O custo estar no TEXTO da mensagem nunca bastou — o texto ninguem soma.
test('REGRESSAO: o custo da correcao entra no frontmatter, e nao so no texto do diario', async () => {
  const id = createCard({
    title: 'correcao que custa',
    status: 'CORRECTING',
    repo: 'org/repo',
    surface: 'visual',
    worktree: wt,
    correction: 'refaca isso',
    cost_usd: '1.0000',
    tokens_total: '500',
  }, '## Objetivo\nalgo\n')

  await handleCorrect(id, agente)
  const c = readCard(id)
  expect(c?.fm.status).toBe('URL')
  // 1.0000 que ja havia + 0.0500 do SUCESSO desta correcao.
  expect(c?.fm.cost_usd, 'sem somar aqui, a proxima guarda de orcamento libera chamada paga sobre um gasto que ela nao conhece').toBe('1.0500')
  // 500 que ja havia + 20 (tokens_in 10 + tokens_out 10) do SUCESSO.
  expect(c?.fm.tokens_total).toBe('520')
}, TEMPO_COM_GIT_MS)
