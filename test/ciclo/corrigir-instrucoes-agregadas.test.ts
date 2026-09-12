import { TEMPO_COM_GIT_MS } from '../tempo-de-teste.ts'
import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, appendFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Card, ImplementResult } from '../../motor/cordel/index.ts'
import type { CorrectDeps } from '../../motor/ciclo/corrigir.ts'
import type { Conferencia, InstrucaoNumerada } from '../../motor/ciclo/crivo/conferencia-de-instrucoes.ts'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-instrucoes-'))
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

const { runStep } = await import('../../motor/ciclo/agente.ts')
const { createCard, readCard } = await import('../../motor/cordel/store.ts')
const { handleCorrect, MAX_VOLTAS_DE_INSTRUCAO } = await import('../../motor/ciclo/corrigir.ts')
const { instruir } = await import('../../motor/mirante/instruir.ts')

afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const CORPO = '## Objetivo\nsubir o preview\n\n## Instrucoes\n1. ajustar o menu mobile\n2. remover o efeito atras da logo\n3. corrigir o z-index dos cards\n'

function sucesso(texto: string): ImplementResult {
  return { ok: true, resultText: texto, fullText: texto, cost: '0.1000', usage: { tokens_in: 10, tokens_out: 10, tokens_cache_create: 0, tokens_cache_read: 0 } }
}

function conclusiva(atendidas: readonly number[], instrucoes: readonly InstrucaoNumerada[]): Conferencia {
  return {
    conclusiva: true,
    itens: instrucoes.map(i => ({ numero: i.numero, atendida: atendidas.includes(i.numero), motivo: atendidas.includes(i.numero) ? 'no diff' : 'nada no diff' })),
    motivo: '',
    cost: 0.01,
    tokens: 5,
    provider: 'claude',
  }
}

function cardEmCorrecao(fm: Record<string, string> = {}): string {
  return createCard({
    title: 'preview do site',
    status: 'CORRECTING',
    repo: 'org/repo',
    surface: 'none',
    worktree: wt,
    correction: 'ajustar o menu mobile',
    ...fm,
  }, CORPO)
}

test('a refacao agrega TODAS as pendentes, confere uma a uma e da outra volta so no que faltou e no que chegou no meio', async () => {
  const id = cardEmCorrecao()
  const pedidos: string[] = []
  const conferidas: number[][] = []
  const deps: CorrectDeps = {
    implement: (card: Card, dir: string, feedback = ''): Promise<ImplementResult> => {
      pedidos.push(feedback)
      appendFileSync(join(dir, 'a.txt'), `volta ${pedidos.length}\n`)
      if (pedidos.length === 1) instruir(card.fm.id ?? '', 'trocar a fonte do titulo')
      return Promise.resolve(sucesso(`volta ${pedidos.length}`))
    },
    runStep,
    conferir: (_id, _wt, _base, instrucoes) => {
      conferidas.push(instrucoes.map(i => i.numero))
      return Promise.resolve(conclusiva(conferidas.length === 1 ? [1, 2] : [3, 4], instrucoes))
    },
  }
  await handleCorrect(id, deps)
  const c = readCard(id)
  expect(pedidos.length).toBe(2)
  expect(pedidos[0] ?? "").toContain('1. ajustar o menu mobile')
  expect(pedidos[0] ?? "").toContain('2. remover o efeito atras da logo')
  expect(pedidos[0] ?? "").toContain('3. corrigir o z-index dos cards')
  expect(pedidos[1] ?? "").toContain('#3 (nada no diff)')
  expect(pedidos[1] ?? "").toContain('3. corrigir o z-index dos cards')
  expect(pedidos[1] ?? "").toContain('4. trocar a fonte do titulo')
  const pedidoDaVolta2 = (pedidos[1] ?? '').slice((pedidos[1] ?? '').indexOf('Refaça atendendo'))
  expect(pedidoDaVolta2).not.toContain('1. ajustar o menu mobile')
  expect(pedidos[1] ?? "").toContain('1 instrução(ões) nova(s)')
  expect(conferidas).toEqual([[1, 2, 3], [3, 4]])
  expect(c?.fm.status).toBe('URL')
  expect(c?.fm.instrucoes_atendidas).toBe('1,2,3,4')
  expect(c?.fm.correction).toBe('')
  expect(c?.body).toContain('instrucao 3: NAO atendida — nada no diff')
  expect(c?.body).toContain('volta 2/3')
  expect(c?.fm.cost_usd).toBe('0.2200')
}, TEMPO_COM_GIT_MS)

test('conferencia inconclusiva nao gira o laco: uma volta, URL, e o diario diz que a decisao ficou com o humano', async () => {
  const id = cardEmCorrecao()
  let chamadas = 0
  const deps: CorrectDeps = {
    implement: (_c, dir): Promise<ImplementResult> => { chamadas++; appendFileSync(join(dir, 'a.txt'), 'x\n'); return Promise.resolve(sucesso('feito')) },
    runStep,
    conferir: () => Promise.resolve({ conclusiva: false, itens: [], motivo: 'gate NAO executou (timeout)', cost: 0, tokens: 0 }),
  }
  await handleCorrect(id, deps)
  const c = readCard(id)
  expect(chamadas).toBe(1)
  expect(c?.fm.status).toBe('URL')
  expect(c?.fm.instrucoes_atendidas ?? '').toBe('')
  expect(c?.body).toContain('conferencia das instrucoes: inconclusiva')
}, TEMPO_COM_GIT_MS)

test('o laco tem teto: depois de N voltas com instrucao ainda nao atendida, entrega em URL e diz o que ficou de fora', async () => {
  const id = cardEmCorrecao()
  let chamadas = 0
  const deps: CorrectDeps = {
    implement: (_c, dir): Promise<ImplementResult> => { chamadas++; appendFileSync(join(dir, 'a.txt'), `${chamadas}\n`); return Promise.resolve(sucesso('tentei')) },
    runStep,
    conferir: (_id, _wt, _base, instrucoes) => Promise.resolve(conclusiva([1, 2], instrucoes)),
  }
  await handleCorrect(id, deps)
  const c = readCard(id)
  expect(chamadas).toBe(MAX_VOLTAS_DE_INSTRUCAO)
  expect(c?.fm.status).toBe('URL')
  expect(c?.fm.instrucoes_atendidas).toBe('1,2')
  expect(c?.body).toContain(`teto de ${MAX_VOLTAS_DE_INSTRUCAO} voltas`)
  expect(c?.body).toContain('#3')
}, TEMPO_COM_GIT_MS)

test('card sem instrucoes numeradas segue o caminho antigo: um pedido com o texto da correcao e nenhuma conferencia', async () => {
  const id = createCard({
    title: 'algo rejeitado',
    status: 'CORRECTING',
    repo: 'org/repo',
    surface: 'none',
    worktree: wt,
    correction: 'refaca isso',
  }, '## Objetivo\nalgo\n')
  const pedidos: string[] = []
  let conferiu = false
  const deps: CorrectDeps = {
    implement: (_c, _dir, feedback = ''): Promise<ImplementResult> => { pedidos.push(feedback); return Promise.resolve(sucesso('refeito')) },
    runStep,
    conferir: () => { conferiu = true; return Promise.resolve({ conclusiva: true, itens: [], motivo: '', cost: 0, tokens: 0 }) },
  }
  await handleCorrect(id, deps)
  expect(pedidos.length).toBe(1)
  expect(pedidos[0] ?? "").toContain('atendendo exatamente: "refaca isso"')
  expect(conferiu).toBe(false)
  expect(readCard(id)?.fm.status).toBe('URL')
}, TEMPO_COM_GIT_MS)

test('REGRESSAO volta 1 ok e volta 2 falha: o custo da volta 1 e da conferencia chega ao cost_usd, nao so ao diario', async () => {
  const id = cardEmCorrecao()
  let volta = 0
  const deps: CorrectDeps = {
    implement: (_c, dir): Promise<ImplementResult> => {
      volta++
      appendFileSync(join(dir, 'a.txt'), `volta ${volta}\n`)
      if (volta === 1) return Promise.resolve(sucesso('volta 1'))
      return Promise.resolve({ ok: false, reason: 'harness caiu', cost: '0.0500', failureClass: 'terminal', failureReason: 'harness caiu' })
    },
    runStep,
    conferir: (_id, _wt, _base, instrucoes) => Promise.resolve(conclusiva([1, 2], instrucoes)),
  }
  await handleCorrect(id, deps)
  const c = readCard(id)
  expect(volta).toBe(2)
  expect(c?.fm.status).toBe('HALTED')
  expect(c?.fm.cost_usd, 'volta 1 (0.10) + conferencia (0.01) + volta 2 falhada (0.05)').toBe('0.1600')
  expect(c?.body).toContain('custo contabilizado')
}, TEMPO_COM_GIT_MS)

test('REGRESSAO correcao pontual (arquivo:linha) que falha tambem contabiliza o que o agente gastou', async () => {
  const id = cardEmCorrecao({ correction_file: 'a.txt', correction_line: '1', correction_line_text: 'um' })
  const deps: CorrectDeps = {
    implement: () => Promise.reject(new Error('nao devia refazer o url inteiro')),
    runStep: () => Promise.resolve({ time: 1, cost: 0.03, costMeasured: true, tokens: 7, text: 'harness caiu', ok: false, failureClass: 'terminal', failureReason: 'harness caiu' }),
  }
  await handleCorrect(id, deps)
  const c = readCard(id)
  expect(c?.fm.status).toBe('HALTED')
  expect(c?.fm.cost_usd).toBe('0.0300')
  expect(c?.fm.tokens_total).toBe('7')
  expect(c?.body).toContain('correção falhou depois de gastar $0.0300')
}, TEMPO_COM_GIT_MS)
