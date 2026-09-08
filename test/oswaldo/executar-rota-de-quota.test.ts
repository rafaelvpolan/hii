// A escada de quota do handleExecute, ponta a ponta com a rota injetada.
//
// O defeito original tinha nome: "primeiro retry: fallback; segundo: parede". A
// primeira falha de cota trocava para o provedor da env; a segunda batia em
// applyFailurePolicy e ia direto a HALTED, mesmo com um terceiro provedor apto na
// maquina. Aqui a escada inteira e percorrida: claude falha -> codex; codex falha ->
// kimi; kimi falha e a rota esgota -> HALTED. E o sucesso limpa a rodada.

import { TEMPO_COM_GIT_MS } from '../tempo-de-teste.ts'
import { test, expect, afterAll, beforeEach } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ImplementResult } from '../../motor/cordel/index.ts'
import type { ExecuteDeps } from '../../motor/oswaldo/executar.ts'
import type { DecisaoDeRota, EntradaDeRota } from '../../motor/tomada/rota.ts'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-rotaquota-'))
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

const { createCard, readCard } = await import('../../motor/cordel/store.ts')
const { handleExecute } = await import('../../motor/oswaldo/executar.ts')

const ESCADA = ['claude', 'codex', 'kimi']

function rotaDaEscada(e: EntradaDeRota): DecisaoDeRota {
  const fora = new Set([e.provedorAtual, ...e.tentadosNestaRodada])
  const proximo = ESCADA.find(nome => !fora.has(nome))
  return proximo
    ? { acao: 'trocar', para: proximo, motivo: 'proximo degrau da escada de teste' }
    : { acao: 'manter_politica_atual', motivo: 'escada de teste esgotada' }
}

function quotaEstourada(provider: string): ImplementResult {
  return {
    ok: false,
    reason: 'limite de uso atingido',
    cost: '0.0100',
    usage: { tokens_in: 1, tokens_out: 1, tokens_cache_create: 0, tokens_cache_read: 0 },
    provider,
    failureClass: 'quota',
    failureReason: `cota de ${provider} esgotada`,
  }
}

function depsQueEstouram(): ExecuteDeps {
  return {
    implement: (card): Promise<ImplementResult> => Promise.resolve(quotaEstourada(card.fm.provider_override_implement || 'claude')),
    verifyVisual: (): Promise<never> => Promise.reject(new Error('nao deveria chamar verifyVisual')),
    rota: rotaDaEscada,
  }
}

let seq = 0

function cardExecutando(): string {
  return createCard({
    title: 'tarefa sob cota apertada',
    status: 'EXECUTING',
    repo: 'org/repo',
    surface: 'none',
    clarified: 'true',
    worktree: join(BASE, `wt-${++seq}`),
  }, '## Objetivo\nqualquer mudanca\n')
}

beforeEach(() => { process.env.HICODE_QUOTA_FALLBACK = 'on' })
afterAll(() => {
  delete process.env.HICODE_QUOTA_FALLBACK
  rmSync(BASE, { recursive: true, force: true })
})

test('REGRESSAO: a escada inteira roda antes da parede — claude -> codex -> kimi -> so entao HALTED', async () => {
  const deps = depsQueEstouram()
  const id = cardExecutando()

  await handleExecute(id, deps)
  let c = readCard(id)
  expect(c?.fm.status, 'primeira falha troca sem sair de EXECUTING — redespacho no proximo tick').toBe('EXECUTING')
  expect(c?.fm.provider_override_implement).toBe('codex')
  expect(c?.fm.rota_tentados).toBe('claude')

  await handleExecute(id, deps)
  c = readCard(id)
  expect(c?.fm.status, 'segunda falha era a parede: agora tenta o terceiro degrau').toBe('EXECUTING')
  expect(c?.fm.provider_override_implement).toBe('kimi')
  expect(c?.fm.rota_tentados).toBe('claude,codex')

  await handleExecute(id, deps)
  c = readCard(id)
  expect(c?.fm.status, 'escada esgotada: ai sim a parede, com classe').toBe('HALTED')
  expect(c?.fm.halt_class).toBe('quota')
  expect(c?.fm.rota_tentados, 'haltFields limpa a rodada').toBe('')
}, TEMPO_COM_GIT_MS)

test('implement bem-sucedido depois da troca limpa override E rodada — a proxima falha recomeca a escada do zero', async () => {
  const deps = depsQueEstouram()
  const id = cardExecutando()
  await handleExecute(id, deps)
  expect(readCard(id)?.fm.provider_override_implement).toBe('codex')

  const sucesso: ExecuteDeps = {
    ...deps,
    implement: (): Promise<ImplementResult> => Promise.resolve({
      ok: true, resultText: 'mudou', fullText: 'mudou', cost: '0.0100',
      usage: { tokens_in: 1, tokens_out: 1, tokens_cache_create: 0, tokens_cache_read: 0 },
    }),
  }
  await handleExecute(id, sucesso)

  const c = readCard(id)
  expect(c?.fm.provider_override_implement).toBe('')
  expect(c?.fm.rota_tentados).toBe('')
}, TEMPO_COM_GIT_MS)

test('com HICODE_QUOTA_FALLBACK desligado a primeira quota ja e HALTED — o comportamento de sempre', async () => {
  delete process.env.HICODE_QUOTA_FALLBACK
  const id = cardExecutando()

  await handleExecute(id, depsQueEstouram())

  const c = readCard(id)
  expect(c?.fm.status).toBe('HALTED')
  expect(c?.fm.halt_class).toBe('quota')
  expect(c?.fm.provider_override_implement ?? '').toBe('')
}, TEMPO_COM_GIT_MS)
