import { TEMPO_COM_GIT_MS } from '../tempo-de-teste.ts'
import { test, expect, afterAll } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { GateResult } from '../../motor/cic/crv/gate.ts'
import type { ImplementResult } from '../../motor/cdl/index.ts'
import type { ExecuteDeps } from '../../motor/osw/executar.ts'
import type { FinishDeps } from '../../motor/qlb/ctr/fechar.ts'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-finishcost-'))
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

let implementCalls = 0

const FALHA: ImplementResult = { ok: false, reason: 'falha simulada (transiente)', cost: '0.1000', usage: { tokens_in: 40, tokens_out: 60, tokens_cache_create: 0, tokens_cache_read: 0 } }
const SUCESSO: ImplementResult = { ok: true, resultText: 'mudou algo', fullText: 'mudou algo', cost: '0.2500', usage: { tokens_in: 70, tokens_out: 130, tokens_cache_create: 0, tokens_cache_read: 0 } }

const GATE_BLOCKED: GateResult = { ok: true, verdict: 'BLOCKED', reason: 'defeito real encontrado pelo crivo', criterio: '', questions: [], cost: 0.05, costMeasured: true, tokens: 500 }

const { createCard, readCard, patchCard } = await import('../../motor/cdl/store.ts')
const { handleExecute } = await import('../../motor/osw/executar.ts')
const { handleFinish } = await import('../../motor/qlb/ctr/fechar.ts')

const agenteExecute: ExecuteDeps = {
  implement: (): Promise<ImplementResult> => {
    implementCalls++
    return Promise.resolve(implementCalls === 1 ? FALHA : SUCESSO)
  },
  verifyVisual: (): Promise<never> => Promise.reject(new Error('nao deveria chamar verifyVisual')),
}

const agenteFinish: FinishDeps = {
  runStep: (): never => { throw new Error('nao deveria chamar runStep — steps: nada nao roda nenhum passo') },
  runCodefoxGate: (): Promise<GateResult> => Promise.resolve(GATE_BLOCKED),
}

afterAll(() => rmSync(BASE, { recursive: true, force: true }))

let seq = 0

function worktreeParaTeste(): string {
  return join(BASE, `wt-${++seq}`)
}

test('REGRESSAO: custo do card NUNCA decresce ao longo de execute->halt->resume->execute->finish(halt)', async () => {
  const wt = worktreeParaTeste()
  const id = createCard({
    title: 'ajuste no rodape',
    status: 'EXECUTING',
    repo: 'org/repo',
    surface: 'none',
    clarified: 'true',
    steps: 'nada',
    worktree: wt,
  }, '## Objetivo\najustar o rodape\n')

  await handleExecute(id, agenteExecute)
  const apos1aFalha = readCard(id)
  expect(apos1aFalha?.fm.status).toBe('HALTED')
  expect(apos1aFalha?.fm.cost_usd).toBe('0.1000')
  expect(apos1aFalha?.fm.tokens_total).toBe('100')

  patchCard(id, { status: 'EXECUTING' }, 'retomado pelo humano (teste)')
  await handleExecute(id, agenteExecute)
  const apos2aExecucao = readCard(id)
  expect(apos2aExecucao?.fm.status).toBe('URL')
  patchCard(id, { status: 'URL_OK' }, 'funcionalidade aprovada pelo humano (teste)')
  expect(apos2aExecucao?.fm.cost_usd).toBe('0.3500')
  expect(apos2aExecucao?.fm.tokens_total).toBe('300')
  expect(parseFloat(apos2aExecucao?.fm.cost_usd ?? '0')).toBeGreaterThanOrEqual(parseFloat(apos1aFalha?.fm.cost_usd ?? '0'))

  await handleFinish(id, agenteFinish)
  const apos3oGateBloqueado = readCard(id)
  expect(apos3oGateBloqueado?.fm.status).toBe('HALTED')
  expect(apos3oGateBloqueado?.fm.cost_usd).toBe('0.4000')
  expect(apos3oGateBloqueado?.fm.tokens_total).toBe('800')
  expect(parseFloat(apos3oGateBloqueado?.fm.cost_usd ?? '0')).toBeGreaterThanOrEqual(parseFloat(apos2aExecucao?.fm.cost_usd ?? '0'))
  expect(existsSync(wt)).toBe(true)
}, TEMPO_COM_GIT_MS)

// O predicado puro decide apenas UMA LINHA DE LOG. Quem de fato impede o segundo
// PR e o `if (prExistente) return prExistente` dentro de executarComIdempotencia,
// e apagar ESSE guard mantinha este teste verde — ele nao podia falhar pelo
// defeito que nomeia.
test('REGRESSAO card com PR ja aberto nao tenta criar PR de novo', async () => {
  const { pularCriacaoDePr } = await import('../../motor/qlb/ctr/pr.ts')
  expect(pularCriacaoDePr('https://github.com/o/r/pull/20')).toBe(true)
  expect(pularCriacaoDePr('')).toBe(false)
  expect(pularCriacaoDePr('   ')).toBe(false)

  // O guard de verdade mora em abrirPrUmaVez, e e exercitado por COMPORTAMENTO nos
  // tres testes abaixo. Aqui fica so o elo: o fecho tem de USAR aquela funcao, e
  // nao reabrir o gh por conta propria.
  const fonte = await Bun.file('motor/qlb/ctr/fechar.ts').text()
  expect(fonte, 'o fecho tem de delegar a abertura').toContain('abrirPrUmaVez(')
  expect(fonte, 'gh pr create fora de abrirPrUmaVez e um segundo caminho sem guarda').not.toContain("'pr', 'create'")
}, TEMPO_COM_GIT_MS)

// A guarda contra o SEGUNDO PR era verificavel so por leitura de texto-fonte:
// apontar `prExistente` para um campo que ninguem escreve mantinha as assercoes de
// existencia e de ordem verdadeiras, e o segundo `gh pr create` voltava. Agora a
// abertura vive em abrirPrUmaVez, com `executar` injetavel.
test('COMPORTAMENTO card com pr_url NAO chama o gh de novo', async () => {
  const { abrirPrUmaVez } = await import('../../motor/qlb/ctr/pr.ts')
  let chamadas = 0
  const ghFalso = async (): Promise<{ err: null; stdout: string; stderr: string }> => {
    chamadas++
    return { err: null, stdout: 'https://github.com/o/r/pull/99\n', stderr: '' }
  }
  const pedido = {
    card: 'pr-existente', repoName: 'o/r', base: 'main', branch: 'b',
    titulo: 't', corpo: 'c', worktree: '/tmp', prExistente: 'https://github.com/o/r/pull/20',
  }
  const r = await abrirPrUmaVez(pedido, ghFalso as unknown as typeof import('../../motor/qlb/git.ts').run)
  expect(chamadas, 'o gh foi chamado num card que ja tem PR: o segundo PR volta assim').toBe(0)
  expect(r.url).toBe('https://github.com/o/r/pull/20')
  expect(r.reaproveitada).toBe(true)
})

test('COMPORTAMENTO card SEM pr_url chama o gh uma vez, e a chave impede a segunda', async () => {
  const { abrirPrUmaVez } = await import('../../motor/qlb/ctr/pr.ts')
  let chamadas = 0
  const ghFalso = async (): Promise<{ err: null; stdout: string; stderr: string }> => {
    chamadas++
    return { err: null, stdout: 'https://github.com/o/r/pull/77\n', stderr: '' }
  }
  const pedido = {
    card: 'pr-novo', repoName: 'o/r', base: 'main', branch: 'b',
    titulo: 't', corpo: 'c', worktree: '/tmp', prExistente: '',
  }
  const tipo = ghFalso as unknown as typeof import('../../motor/qlb/git.ts').run
  const primeira = await abrirPrUmaVez(pedido, tipo)
  expect(chamadas).toBe(1)
  expect(primeira.url).toBe('https://github.com/o/r/pull/77')
  expect(primeira.reaproveitada).toBe(false)

  const segunda = await abrirPrUmaVez(pedido, tipo)
  expect(chamadas, 'a chave de idempotencia tem de impedir a segunda abertura').toBe(1)
  expect(segunda.url).toBe('https://github.com/o/r/pull/77')
  expect(segunda.reaproveitada).toBe(true)
})

test('COMPORTAMENTO gh que falha nao registra efeito, e o erro chega ao chamador', async () => {
  const { abrirPrUmaVez } = await import('../../motor/qlb/ctr/pr.ts')
  let chamadas = 0
  const ghQuebrado = async (): Promise<{ err: Error; stdout: string; stderr: string }> => {
    chamadas++
    return { err: new Error('exit 1'), stdout: '', stderr: 'gh: could not create pull request\n' }
  }
  const pedido = {
    card: 'pr-falha', repoName: 'o/r', base: 'main', branch: 'b',
    titulo: 't', corpo: 'c', worktree: '/tmp', prExistente: '',
  }
  const tipo = ghQuebrado as unknown as typeof import('../../motor/qlb/git.ts').run
  const r = await abrirPrUmaVez(pedido, tipo)
  expect(r.url).toBe('')
  expect(r.erro).toContain('could not create')
  // Falha NAO grava a chave: a operacao tem de continuar tentavel.
  await abrirPrUmaVez(pedido, tipo)
  expect(chamadas, 'efeito que nao aconteceu nao pode trancar a operacao para sempre').toBe(2)
})
