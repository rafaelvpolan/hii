import { TEMPO_COM_GIT_MS } from '../tempo-de-teste.ts'
import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { GateResult } from '../../motor/ciclo/crivo/gate.ts'
import type { FinishDeps } from '../../motor/quilombo/cartorio/fechar.ts'

// Quilombo — o pipeline manual de ponta a ponta: a url aprovada NAO dispara os
// passos pagos, o card pausa, cada passo roda por pedido (`hii passo` / TUI) e a
// suite (`/hii`, ENTER) roda o restante sem repagar o que ja foi feito. Mesma
// infra do fechar-wait-attempts: repo git de verdade, gh falso, agentes injetados.

const BASE = mkdtempSync(join(tmpdir(), 'hicode-pipeline-manual-'))
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

const PR_FALSO = 'https://github.com/org/repo/pull/997'
const ghBinDir = join(BASE, 'bin-fake-gh')
mkdirSync(ghBinDir, { recursive: true })
const ghFalso = join(ghBinDir, 'gh')
writeFileSync(ghFalso, `#!/usr/bin/env bash\nif [ "$1" = "pr" ] && [ "$2" = "create" ]; then\n  echo "${PR_FALSO}"\n  exit 0\nfi\necho "gh-falso: comando nao suportado: $*" >&2\nexit 1\n`)
chmodSync(ghFalso, 0o755)
const pathOriginal = process.env.PATH ?? ''
process.env.PATH = `${ghBinDir}:${pathOriginal}`

const realGit = await import('../../motor/quilombo/git.ts')
const { createCard, readCard } = await import('../../motor/cordel/store.ts')
const { handleFinish } = await import('../../motor/quilombo/cartorio/fechar.ts')
const { pedirPassoManual, pedirSuiteManual } = await import('../../motor/quilombo/cartorio/passos-manuais.ts')

afterAll(() => {
  process.env.PATH = pathOriginal
  rmSync(BASE, { recursive: true, force: true })
})

let sequencia = 0

// Card pronto para o fecho: url aprovada, worktree com um commit a frente da base.
async function cardPronto(campos: Record<string, string> = {}): Promise<{ id: string; wt: string }> {
  sequencia += 1
  const slug = `pm-${sequencia}`
  const wt = join(BASE, `wt-${slug}`)
  const id = createCard({
    title: 'pipeline manual de teste',
    status: 'URL_OK',
    repo: 'org/repo',
    surface: 'none',
    clarified: 'true',
    steps: 'all',
    slug,
    worktree: wt,
    ...campos,
  }, '## Objetivo\nexercitar o pipeline manual\n')
  await realGit.ensureWorktree(clone, wt, `hicode/${id}-${slug}`, 'main')
  writeFileSync(join(wt, 'mudanca.txt'), `conteudo ${sequencia}\n`)
  git(wt, ['add', '-A'])
  git(wt, ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'feat: mudanca'])
  return { id, wt }
}

const agenteQueNaoDeveRodar: FinishDeps = {
  runStep: (): never => { throw new Error('runStep chamado num fecho que deveria ter PAUSADO') },
  runCodefoxGate: (): Promise<GateResult> => Promise.resolve(GATE_APROVADO),
}

test('url aprovada em modo manual PAUSA sem rodar nenhum passo — e o diario diz o que pedir', async () => {
  const { id } = await cardPronto()
  await handleFinish(id, agenteQueNaoDeveRodar)
  const c = readCard(id)
  expect(c?.fm.status).toBe('PAUSED')
  expect(c?.fm.pipeline_pausa).toBe('manual')
  expect(c?.fm.retomar_em).toBe('URL_OK')
  expect(c?.body).toContain('pipeline manual')
  expect(c?.body).toContain('/testes')
}, TEMPO_COM_GIT_MS)

test('pedido de passo roda SO ele e volta a pausar, com o label em pipeline_feitos', async () => {
  const { id } = await cardPronto({ pipeline_feitos: 'Arquitetura,Testes,Seguranca' })
  const pedido = pedirPassoManual(id, 'limpeza')
  expect(pedido.ok).toBe(true)
  expect(readCard(id)?.fm.status).toBe('URL_OK')

  const agentes: string[] = []
  const deps: FinishDeps = {
    runStep: (_wt: string, agent: string) => {
      agentes.push(agent)
      return Promise.resolve({ ok: true, time: 1, cost: 0.001, tokens: 10, costMeasured: true, text: 'limpo' })
    },
    runCodefoxGate: (): Promise<GateResult> => Promise.resolve(GATE_APROVADO),
  }
  await handleFinish(id, deps)
  const c = readCard(id)
  expect(agentes).toEqual(['pura'])
  expect(c?.fm.status).toBe('PAUSED')
  expect(c?.fm.pipeline_feitos).toBe('Arquitetura,Testes,Seguranca,Limpeza')
  expect(c?.fm.pipeline_passo).toBe('')
  expect(c?.fm.cost_usd).toBe('0.0010')
  expect(c?.body).toContain('pipeline completo')
}, TEMPO_COM_GIT_MS)

test('pedido de passo fora do plano volta a PAUSED com o motivo, sem gastar nada', async () => {
  const { id } = await cardPronto({ pipeline_feitos: 'Arquitetura,Testes,Seguranca,Limpeza' })
  const pedido = pedirPassoManual(id, 'limpeza')
  expect(pedido.ok, 'o id existe no pipeline — quem recusa e o plano do card').toBe(true)
  await handleFinish(id, agenteQueNaoDeveRodar)
  const c = readCard(id)
  expect(c?.fm.status).toBe('PAUSED')
  expect(c?.fm.pipeline_passo).toBe('')
  expect(c?.body).toContain('nao esta no plano deste card')
}, TEMPO_COM_GIT_MS)

test('suite liberada com todos os passos feitos vai ao fecho (PR_OPEN) e limpa os marcadores', async () => {
  const { id } = await cardPronto({
    status: 'PAUSED',
    pipeline_pausa: 'manual',
    pipeline_feitos: 'Arquitetura,Testes,Seguranca,Limpeza',
  })
  const suite = pedirSuiteManual(id)
  expect(suite.ok).toBe(true)
  // A guarda de parada do store.ts e o ponto do teste: sem apesarDaParada o
  // status ficaria PAUSED e o pedido virava campo morto fora da fila.
  expect(readCard(id)?.fm.status).toBe('URL_OK')

  await handleFinish(id, agenteQueNaoDeveRodar)
  const c = readCard(id)
  expect(c?.fm.status).toBe('PR_OPEN')
  expect(c?.fm.pr_url).toBe(PR_FALSO)
  expect(c?.fm.pipeline_pausa).toBe('')
  expect(c?.fm.pipeline_liberado).toBe('')
  expect(c?.fm.pipeline_feitos).toBe('')
  expect(c?.fm.pipeline_passo).toBe('')
}, TEMPO_COM_GIT_MS)

test('modo automatico (pipeline: auto no card) NAO pausa — vai direto ao fecho como antes', async () => {
  const { id } = await cardPronto({ pipeline: 'auto', steps: 'nada' })
  await handleFinish(id, agenteQueNaoDeveRodar)
  const c = readCard(id)
  expect(c?.fm.status).toBe('PR_OPEN')
  expect(c?.fm.pipeline_pausa ?? '').toBe('')
}, TEMPO_COM_GIT_MS)

test('guardas do pedido: card inexistente, passo desconhecido e card em modo automatico', async () => {
  expect(pedirPassoManual('999', 'testes').ok).toBe(false)
  const { id } = await cardPronto()
  const desconhecido = pedirPassoManual(id, 'banana')
  expect(desconhecido.ok).toBe(false)
  expect(desconhecido.mensagem).toContain('passo desconhecido')
  const { id: auto } = await cardPronto({ pipeline: 'auto' })
  const recusado = pedirPassoManual(auto, 'testes')
  expect(recusado.ok).toBe(false)
  expect(recusado.mensagem).toContain('pipeline automatico')
}, TEMPO_COM_GIT_MS)
