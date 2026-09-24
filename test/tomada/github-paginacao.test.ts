import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executarComIdempotencia, FASE_DA_PONTE } from '../../motor/quilombo/salvo-conduto/idempotencia.ts'
import { test, expect } from '../apoio/runner.ts'
import { GithubIssuesSync, parseIssues } from '../../motor/tomada/ponte/tarefas/github-issues.ts'
import type { RunResult } from '../../motor/quilombo/git.ts'
import { createCard, readCard } from '../../motor/cordel/store.ts'
import { runSync } from '../../motor/tomada/ponte/tarefas/sync.ts'

function ok(stdout: string): RunResult { return { err: null, stdout, stderr: '' } }

test('le todas as paginas e exclui pull requests sem perder issues acima de 50', async () => {
  const comandos: string[][] = []
  const sync = new GithubIssuesSync(async (_, args) => {
    comandos.push(args)
    if (args[0] === 'repo') return ok('{"url":"https://github.com/org/app"}')
    return ok(JSON.stringify([
      Array.from({ length: 100 }, (_, i) => ({ number: i + 1, title: `Issue ${i + 1}` })),
      [{ number: 101, title: 'ultima' }, { number: 102, title: 'PR', pull_request: {} }],
    ]))
  })
  const tarefas = await sync.pull()
  expect(tarefas.length).toBe(101)
  expect(tarefas[100]?.source).toBe('github-issues#https://github.com/org/app/issues/101')
  expect(tarefas[100]?.repo).toBe('org/app')
  expect(comandos[1]).toContain('--paginate')
  expect(comandos[1]).toContain('--slurp')
})
test('mesmo numero em repositorios e instancias diferentes conserva identidade', () => {
  const corpo = '[{"number":1,"title":"a"}]'
  const origens = ['https://github.com/org/a', 'https://github.com/org/b', 'https://git.example/org/a']
  expect(new Set(origens.map(o => parseIssues(corpo, o)[0]?.source)).size).toBe(3)
})
test('falha de pagina posterior nao entrega lista parcial', async () => {
  const sync = new GithubIssuesSync(async (_, args) => args[0] === 'repo' ? ok('{"url":"https://github.com/org/app"}') :
    { err: new Error('rate limit'), stdout: '[[{"number":1,"title":"a"}]]', stderr: 'rate limit' })
  let erro = ''
  try { await sync.pull() } catch (e) { erro = String(e) }
  expect(erro).toContain('nenhuma lista parcial')
})
test('registro malformado nao desaparece silenciosamente', () => {
  for (const item of [null, {}, { number: 1.5, title: 'x' }, { number: 1, title: 42 }]) {
    expect(() => parseIssues(JSON.stringify([item]))).toThrow()
  }
})
test('origem legada ambigua nao gera comentario em outro projeto', async () => {
  let chamadas = 0
  const sync = new GithubIssuesSync(async () => { chamadas++; return ok('') })
  let erro = ''
  try { await sync.push({ id: '001', source: 'github-issues#1', repo: 'outro/projeto' }) } catch (e) { erro = String(e) }
  expect(erro).toContain('ambigua')
  expect(chamadas).toBe(0)
})

test('origem legada preserva o diario e nao republica comentario ja confirmado', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hii-sync-legado-'))
  const cardsAntes = process.env.HII_CARDS_DIR
  const repoAntes = process.env.HII_GH_REPO
  process.env.HII_CARDS_DIR = dir
  process.env.HII_GH_REPO = 'org/app'
  try {
    await executarComIdempotencia({ card: '001', fase: FASE_DA_PONTE, operacao: 'issue_comment:READY', executar: async () => 'comentario anterior' })
    let chamadas = 0
    const sync = new GithubIssuesSync(async () => { chamadas++; return ok('novo comentario') })
    expect(await sync.push({ id: '001', source: 'github-issues#1', repo: 'org/app', status: 'READY' })).toBe(false)
    expect(chamadas).toBe(0)
  } finally {
    if (cardsAntes === undefined) delete process.env.HII_CARDS_DIR
    else process.env.HII_CARDS_DIR = cardsAntes
    if (repoAntes === undefined) delete process.env.HII_GH_REPO
    else process.env.HII_GH_REPO = repoAntes
    rmSync(dir, { recursive: true, force: true })
  }
})

test('issue fechada pausa card ativo; reabertura nao retoma sem humano', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hii-tracker-reconcile-'))
  const env = { ...process.env }
  try {
    const bin = join(dir, 'bin'); mkdirSync(bin)
    process.env.PATH = `${bin}:${env.PATH ?? ''}`
    process.env.HII_CARDS_DIR = join(dir, 'cards')
    process.env.HII_TASK_SYNC = 'github-issues'
    process.env.HII_GH_REPO = 'org/app'
    writeFileSync(join(bin, 'gh'), `#!/bin/sh
if [ "$1" = repo ]; then printf '%s' '{"url":"https://github.com/org/app"}'; exit 0; fi
if [ "$1" = api ]; then printf '%s' '[[{"number":7,"title":"externa","state":"closed","labels":[]}]]'; exit 0; fi
printf '%s' 'comentado'
`)
    chmodSync(join(bin, 'gh'), 0o755)
    const id = createCard({ title: 'externa', repo: 'org/app', status: 'READY', source: 'github-issues#https://github.com/org/app/issues/7' }, 'objetivo')
    expect((await runSync()).ok).toBe(true)
    expect(readCard(id)?.fm.status).toBe('PAUSED')
    expect(readCard(id)?.fm.tracker_state).toBe('closed')
    writeFileSync(join(bin, 'gh'), readFileSync(join(bin, 'gh'), 'utf8').replace('"state":"closed"', '"state":"open"'))
    expect((await runSync()).ok).toBe(true)
    expect(readCard(id)?.fm.status).toBe('PAUSED')
    expect(readCard(id)?.fm.tracker_state).toBe('open')
  } finally { process.env = env; rmSync(dir, { recursive: true, force: true }) }
})
