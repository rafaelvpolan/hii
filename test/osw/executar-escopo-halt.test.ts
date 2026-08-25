import { TEMPO_COM_GIT_MS } from '../tempo-de-teste.ts'
import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ImplementResult } from '../../motor/cdl/index.ts'
import type { ExecuteDeps } from '../../motor/osw/executar.ts'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-escopohalt-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(process.env.HICODE_CARDS_DIR, { recursive: true })

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

const origem = join(BASE, 'origem.git')
const semente = join(BASE, 'semente')
const clone = join(BASE, 'clone')
mkdirSync(join(semente, 'referencia'), { recursive: true })
execFileSync('git', ['init', '-q', '--bare', origem])
git(semente, ['init', '-q', '.'])
git(semente, ['config', 'user.email', 't@t'])
git(semente, ['config', 'user.name', 't'])
writeFileSync(join(semente, 'referencia', 'cor.css'), ':root{--a:#111}\n')
writeFileSync(join(semente, 'alvo.html'), '<p>oi</p>\n')
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

const { createCard, readCard } = await import('../../motor/cdl/store.ts')
const { handleExecute } = await import('../../motor/osw/executar.ts')

const USO = { tokens_in: 10, tokens_out: 20, tokens_cache_create: 0, tokens_cache_read: 0 }

// O agente faz EXATAMENTE o que fez na sessao real: edita o projeto que o pedido
// mandou apenas LER. Sem escrever em disco o teste nao prova nada — o motor
// confere o `git diff`, nao a intencao declarada.
type Acao = 'edita-referencia' | 'edita-alvo' | 'cria-na-referencia' | 'apaga-referencia'

function implementQue(acao: Acao): ExecuteDeps {
  return {
    implement: (_card, wt): Promise<ImplementResult> => {
      if (acao === 'edita-referencia') writeFileSync(join(wt, 'referencia', 'cor.css'), ':root{--a:#fff}\n')
      if (acao === 'edita-alvo') writeFileSync(join(wt, 'alvo.html'), '<p>mudado</p>\n')
      if (acao === 'cria-na-referencia') writeFileSync(join(wt, 'referencia', 'novo.css'), ':root{--b:#000}\n')
      if (acao === 'apaga-referencia') rmSync(join(wt, 'referencia', 'cor.css'))
      return Promise.resolve({ ok: true, resultText: 'mudou', fullText: 'mudou', cost: '0.0500', usage: USO })
    },
    verifyVisual: (): Promise<never> => Promise.reject(new Error('nao deveria chegar em verifyVisual')),
  }
}

afterAll(() => rmSync(BASE, { recursive: true, force: true }))

let seq = 0

function card(): string {
  return createCard({
    title: 'deixar as cores iguais',
    status: 'EXECUTING',
    repo: 'org/repo',
    surface: 'none',
    clarified: 'true',
    worktree: join(BASE, `wt-${++seq}`),
    cost_usd: '1.0000',
    tokens_total: '500',
  }, '## Objetivo\nveja as cores conforme o padrao referencia/ e aplique em alvo.html\n')
}

test('escrever na REFERENCIA para a tarefa em HALTED antes de gastar no resto', async () => {
  const id = card()
  await handleExecute(id, implementQue('edita-referencia'))
  const c = readCard(id)
  expect(c?.fm.status, 'o pedido marcou referencia/ como so-leitura').toBe('HALTED')
  expect(c?.fm.escopo_violado).toBe('referencia/cor.css')
  expect(c?.fm.escopo_alvos).toBe('alvo.html')
}, TEMPO_COM_GIT_MS)

// O implement JA gastou quando o motor descobre a violacao. Gasto nao lancado
// tambem cega o teto de orcamento: o retry seguinte comeca achando que o card
// nao custou nada.
test('REGRESSAO: o HALT de escopo LANCA o gasto do implement, nao o perde', async () => {
  const id = card()
  await handleExecute(id, implementQue('edita-referencia'))
  const c = readCard(id)
  expect(c?.fm.status).toBe('HALTED')
  expect(c?.fm.cost_usd, 'US$0.05 do implement somado ao US$1.00 que ja estava no card').toBe('1.0500')
  expect(c?.fm.tokens_total).toBe('530')
}, TEMPO_COM_GIT_MS)

test('escrever no ALVO segue o fluxo normal — o escopo nao pode virar freio geral', async () => {
  const id = card()
  await handleExecute(id, implementQue('edita-alvo'))
  const c = readCard(id)
  expect(c?.fm.status, 'escrita dentro do alvo e o caso feliz').toBe('URL')
  expect(c?.fm.escopo_violado ?? '').toBe('')
}, TEMPO_COM_GIT_MS)

// `git diff --name-only HEAD` NAO lista arquivo novo. Sem isto o agente CRIAVA na
// referencia, nao havia HALT, e `git add -A` no commit levava o arquivo para o PR.
test('REGRESSAO: arquivo CRIADO na referencia tambem para a tarefa', async () => {
  const id = card()
  await handleExecute(id, implementQue('cria-na-referencia'))
  const c = readCard(id)
  expect(c?.fm.status, 'criar dentro da referencia e escrever nela').toBe('HALTED')
  expect(c?.fm.escopo_violado).toBe('referencia/novo.css')
}, TEMPO_COM_GIT_MS)

// O escopo era lido DEPOIS do implement: apagar a referencia fazia o existsSync
// falhar, o caminho saia de `referencias`, e com `referencias` vazio a checagem
// curto-circuitava — a violacao mais grave desligava a propria guarda.
test('REGRESSAO: APAGAR a referencia nao desliga a checagem de escopo', async () => {
  const id = card()
  await handleExecute(id, implementQue('apaga-referencia'))
  const c = readCard(id)
  expect(c?.fm.status, 'apagar a referencia e o pior caso, nao um caso isento').toBe('HALTED')
  expect(c?.fm.escopo_violado).toBe('referencia/cor.css')
}, TEMPO_COM_GIT_MS)

// `res.ok` e true (o implement rodou), mas o card PAROU. Gravar o run como sucesso
// deixava a causa fora do ledger: quem le runs/*.json para taxa de sucesso, ou para
// saber por que o card parou, nao encontrava nada.
test('REGRESSAO: o run do HALT de escopo carimba a falha, nao "ok"', async () => {
  const id = card()
  await handleExecute(id, implementQue('edita-referencia'))
  const c = readCard(id)
  expect(c?.fm.status).toBe('HALTED')
  const dir = join(process.env.HICODE_CARDS_DIR ?? '', 'runs')
  const arquivos = readdirSync(dir).filter(f => f.startsWith(`${id}-`))
  expect(arquivos.length, 'o HALT tem de gravar um run').toBeGreaterThan(0)
  const runs = arquivos.map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')) as { ok: boolean; failure_class?: string; failure_reason?: string })
  const ultimo = runs[runs.length - 1]
  expect(ultimo?.ok, 'o card parou — o ledger nao pode dizer sucesso').toBe(false)
  expect(ultimo?.failure_class).toBe('terminal')
  expect(ultimo?.failure_reason, 'a causa tem de estar no registro').toContain('fora do escopo')
}, TEMPO_COM_GIT_MS)
