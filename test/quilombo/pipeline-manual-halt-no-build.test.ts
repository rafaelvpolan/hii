import { TEMPO_COM_GIT_MS } from '../tempo-de-teste.ts'
import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { GateResult } from '../../motor/ciclo/crivo/gate.ts'
import type { FinishDeps } from '../../motor/quilombo/cartorio/fechar.ts'

// Quilombo — a liberacao grudenta de ponta a ponta: /hii libera a suite, o
// build reprova e o card HALTa; o pedido de passo unico seguinte tem de rodar SO
// aquele passo e pausar, em vez de a liberacao velha transformar o pedido na
// suite inteira (passos + build de novo). O repo alvo tem um script de build que
// SEMPRE falha, entao o HALT vem do caminho real de portoes-de-fecho.ts.

const BASE = mkdtempSync(join(tmpdir(), 'hicode-halt-no-build-'))
delete process.env.HICODE_RIGOR_ESTRITO
delete process.env.HICODE_PIPELINE
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
writeFileSync(join(semente, 'package.json'), JSON.stringify({ name: 'alvo-com-build-quebrado', private: true, scripts: { build: 'exit 1' } }, null, 2) + '\n')
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

const GATE_APROVADO: GateResult = { ok: true, verdict: 'APPROVED', reason: 'sem defeito real encontrado', criterio: '', questions: [], cost: 0.01, costMeasured: true, tokens: 100 }

const realGit = await import('../../motor/quilombo/git.ts')
const { createCard, readCard } = await import('../../motor/cordel/store.ts')
const { handleFinish } = await import('../../motor/quilombo/cartorio/fechar.ts')
const { pedirPassoManual, pedirSuiteManual } = await import('../../motor/quilombo/cartorio/passos-manuais.ts')
const { RESUME_POST_STEPS } = await import('../../motor/quilombo/cartorio/retomar.ts')

afterAll(() => {
  rmSync(BASE, { recursive: true, force: true })
})

async function cardPausadoComTresPassosPagos(): Promise<string> {
  const slug = 'halt-no-build'
  const wt = join(BASE, `wt-${slug}`)
  const id = createCard({
    title: 'suite que quebra no build',
    status: 'PAUSED',
    repo: 'org/repo',
    surface: 'none',
    clarified: 'true',
    steps: 'all',
    slug,
    worktree: wt,
    pipeline_pausa: 'manual',
    pipeline_feitos: 'arquitetura,testes,seguranca',
  }, '## Objetivo\nexercitar o HALT no build do pipeline manual\n')
  await realGit.ensureWorktree(clone, wt, `hicode/${id}-${slug}`, 'main')
  writeFileSync(join(wt, 'mudanca.txt'), 'conteudo\n')
  git(wt, ['add', '-A'])
  git(wt, ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'feat: mudanca'])
  return id
}

function depsQueAnotam(agentes: string[]): FinishDeps {
  return {
    runStep: (_wt: string, agent: string) => {
      agentes.push(agent)
      return Promise.resolve({ ok: true, time: 1, cost: 0.001, tokens: 10, costMeasured: true, text: 'ok' })
    },
    runCodefoxGate: (): Promise<GateResult> => Promise.resolve(GATE_APROVADO),
  }
}

test('REGRESSAO suite -> HALT no build -> pedido de passo unico roda SO o passo e pausa, sem a liberacao velha puxar a suite inteira', async () => {
  const id = await cardPausadoComTresPassosPagos()
  expect(pedirSuiteManual(id).ok).toBe(true)
  expect(readCard(id)?.fm.pipeline_liberado).toBe('true')

  const agentesDaSuite: string[] = []
  await handleFinish(id, depsQueAnotam(agentesDaSuite))
  const parado = readCard(id)
  expect(parado?.fm.status, 'o build do alvo sempre falha — a suite tem de HALTar depois de esgotar os reajustes').toBe('HALTED')
  expect(agentesDaSuite[0]).toBe('pura')
  expect(agentesDaSuite.length, 'limpeza + reajustes de build').toBeGreaterThan(1)
  expect(parado?.fm.resume_from).toBe(RESUME_POST_STEPS)
  expect(parado?.fm.pipeline_liberado, 'o HALT dentro do fecho nao pode deixar a liberacao gravada').toBe('')
  expect(parado?.fm.pipeline_pausa).toBe('manual')

  const pedido = pedirPassoManual(id, 'limpeza')
  expect(pedido.ok).toBe(true)
  expect(pedido.mensagem).toContain('so "limpeza"')

  const agentesDoPasso: string[] = []
  await handleFinish(id, depsQueAnotam(agentesDoPasso))
  const depois = readCard(id)
  expect(agentesDoPasso, 'so o passo pedido: nenhum reajuste de build, nenhum outro passo').toEqual(['pura'])
  expect(depois?.fm.status).toBe('PAUSED')
  expect(depois?.fm.pipeline_liberado).toBe('')
  expect(depois?.fm.pipeline_passo).toBe('')
  expect(depois?.fm.pipeline_feitos).toBe('arquitetura,testes,seguranca,limpeza')
  expect(depois?.fm.pr_url ?? '').toBe('')
}, TEMPO_COM_GIT_MS)

test('a SUITE anota cada passo pago: HALT no build e novo /hii nao pagam a limpeza de novo', async () => {
  const id = await cardPausadoComTresPassosPagos()
  expect(pedirSuiteManual(id).ok).toBe(true)
  const primeira: string[] = []
  await handleFinish(id, depsQueAnotam(primeira))
  const parado = readCard(id)
  expect(parado?.fm.status).toBe('HALTED')
  expect(primeira[0]).toBe('pura')
  expect(parado?.fm.pipeline_feitos, 'a suite passou a anotar o passo assim que ele termina, antes do build').toBe('arquitetura,testes,seguranca,limpeza')

  const segundo = pedirSuiteManual(id)
  expect(segundo.ok).toBe(true)
  expect(segundo.mensagem).toContain('nada — vai direto ao fecho')
  const segunda: string[] = []
  await handleFinish(id, depsQueAnotam(segunda))
  expect(segunda.includes('pura'), 'repetir a suite nao pode pagar a limpeza outra vez').toBe(false)
  expect(readCard(id)?.fm.status).toBe('HALTED')
}, TEMPO_COM_GIT_MS * 2)

test('pedido EXPLICITO de um passo ja pago roda de novo, avisando no diario e na resposta', async () => {
  const id = await cardPausadoComTresPassosPagos()
  const primeiro = pedirPassoManual(id, '/limpeza')
  expect(primeiro.ok).toBe(true)
  expect(primeiro.mensagem).not.toContain('ja rodou')
  const agentes1: string[] = []
  await handleFinish(id, depsQueAnotam(agentes1))
  expect(agentes1).toEqual(['pura'])
  expect(readCard(id)?.fm.pipeline_feitos).toBe('arquitetura,testes,seguranca,limpeza')

  const repetido = pedirPassoManual(id, '/limpeza')
  expect(repetido.ok).toBe(true)
  expect(repetido.mensagem).toContain('ja rodou nesta rodada')
  const agentes2: string[] = []
  await handleFinish(id, depsQueAnotam(agentes2))
  const depois = readCard(id)
  expect(agentes2, 'o pedido explicito vence o ledger: o passo roda de novo').toEqual(['pura'])
  expect(depois?.fm.status).toBe('PAUSED')
  expect(depois?.body).toContain('ja rodou nesta rodada — rodando de novo a pedido do humano')
  expect(depois?.fm.pipeline_feitos, 'sem duplicar o id no ledger').toBe('arquitetura,testes,seguranca,limpeza')
}, TEMPO_COM_GIT_MS * 2)
