import { TEMPO_COM_GIT_MS } from '../tempo-de-teste.ts'
import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Card, ImplementResult } from '../../motor/cordel/index.ts'
import type { ExecuteDeps } from '../../motor/oswaldo/executar.ts'
import type { Conferencia, InstrucaoNumerada } from '../../motor/ciclo/crivo/conferencia-de-instrucoes.ts'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-execinstr-'))
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
writeFileSync(join(semente, '.gitignore'), 'node_modules/\n')
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
const { instruir } = await import('../../motor/mirante/instruir.ts')

afterAll(() => rmSync(BASE, { recursive: true, force: true }))

let seq = 0

function sucesso(texto: string): ImplementResult {
  return { ok: true, resultText: texto, fullText: texto, cost: '0.0500', usage: { tokens_in: 10, tokens_out: 20, tokens_cache_create: 0, tokens_cache_read: 0 } }
}

function conclusiva(atendidas: readonly number[], instrucoes: readonly InstrucaoNumerada[]): Conferencia {
  return {
    conclusiva: true,
    itens: instrucoes.map(i => ({ numero: i.numero, atendida: atendidas.includes(i.numero), motivo: atendidas.includes(i.numero) ? 'no diff' : 'nada no diff' })),
    motivo: '',
    cost: 0.02,
    tokens: 7,
    provider: 'claude',
  }
}

function cardParaExecutar(): string {
  return createCard({
    title: 'ajuste no rodape',
    status: 'EXECUTING',
    repo: 'org/repo',
    surface: 'none',
    clarified: 'true',
    worktree: join(BASE, `wt-${++seq}`),
  }, '## Objetivo\najustar o rodape\n')
}

const semVisual = (): Promise<never> => Promise.reject(new Error('nao deveria chamar verifyVisual'))

test('REGRESSAO card 005: agente que nao mexe em arquivo rastreado, com node_modules solto no worktree, NAO vira HALT — segue para URL', async () => {
  const id = cardParaExecutar()
  const deps: ExecuteDeps = {
    implement: (_c: Card, wt: string): Promise<ImplementResult> => {
      symlinkSync(join(BASE, 'inexistente-node_modules'), join(wt, 'node_modules'))
      return Promise.resolve(sucesso('nada a mudar: o preview ja sobe com npm run dev'))
    },
    verifyVisual: semVisual,
  }
  await handleExecute(id, deps)
  const c = readCard(id)
  expect(c?.fm.status).toBe('URL')
  expect(c?.fm.halt_class ?? '').toBe('')
  expect(c?.body).toContain('nada a commitar')
}, TEMPO_COM_GIT_MS)

test('instrucao que chega DURANTE a execucao e conferida no fim: nao atendida manda o card a CORRECTING em vez de te chamar', async () => {
  const id = cardParaExecutar()
  const conferidas: number[][] = []
  const deps: ExecuteDeps = {
    implement: (card: Card, wt: string): Promise<ImplementResult> => {
      writeFileSync(join(wt, 'a.txt'), 'dois\n')
      instruir(card.fm.id ?? '', 'trocar a cor do rodape')
      return Promise.resolve(sucesso('rodape ajustado'))
    },
    verifyVisual: semVisual,
    conferir: (_id, _wt, _base, instrucoes) => {
      conferidas.push(instrucoes.map(i => i.numero))
      return Promise.resolve(conclusiva([], instrucoes))
    },
  }
  await handleExecute(id, deps)
  const c = readCard(id)
  expect(conferidas).toEqual([[1]])
  expect(c?.fm.status).toBe('CORRECTING')
  expect(c?.fm.instrucoes_atendidas ?? '').toBe('')
  expect(c?.body).toContain('URL->CORRECTING instrução(ões) #1 ainda não atendida(s)')
  expect(c?.fm.cost_usd).toBe('0.0700')
}, TEMPO_COM_GIT_MS)

test('instrucao que a conferencia da como atendida fica marcada no ledger e o card segue em URL', async () => {
  const id = cardParaExecutar()
  const deps: ExecuteDeps = {
    implement: (card: Card, wt: string): Promise<ImplementResult> => {
      writeFileSync(join(wt, 'a.txt'), 'tres\n')
      instruir(card.fm.id ?? '', 'trocar a cor do rodape')
      return Promise.resolve(sucesso('rodape ajustado com a cor nova'))
    },
    verifyVisual: semVisual,
    conferir: (_id, _wt, _base, instrucoes) => Promise.resolve(conclusiva([1], instrucoes)),
  }
  await handleExecute(id, deps)
  const c = readCard(id)
  expect(c?.fm.status).toBe('URL')
  expect(c?.fm.instrucoes_atendidas).toBe('1')
  expect(c?.body).toContain('instrucao 1: ATENDIDA')
}, TEMPO_COM_GIT_MS)

test('sem instrucoes no corpo a conferencia nem e chamada', async () => {
  const id = cardParaExecutar()
  let conferiu = false
  const deps: ExecuteDeps = {
    implement: (_c: Card, wt: string): Promise<ImplementResult> => { writeFileSync(join(wt, 'a.txt'), 'quatro\n'); return Promise.resolve(sucesso('ok')) },
    verifyVisual: semVisual,
    conferir: () => { conferiu = true; return Promise.resolve({ conclusiva: true, itens: [], motivo: '', cost: 0, tokens: 0 }) },
  }
  await handleExecute(id, deps)
  expect(conferiu).toBe(false)
  expect(readCard(id)?.fm.status).toBe('URL')
}, TEMPO_COM_GIT_MS)
