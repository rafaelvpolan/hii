import { test, expect, afterAll } from '../apoio/runner.ts'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-serve-'))
const REPO = join(BASE, 'app')
mkdirSync(join(BASE, 'cards', 'runs'), { recursive: true })
mkdirSync(REPO, { recursive: true })
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
process.env.HICODE_REPOS_FILE = join(BASE, 'repos.json')
writeFileSync(process.env.HICODE_REPOS_FILE, JSON.stringify([{ name: 'org/app', path: REPO, branch: 'main' }]))

const { comandoServir, interpretarServe, lerServidor, resolverAlvo } = await import('../../motor/mirante/servir.ts')
const { createCard } = await import('../../motor/cordel/store.ts')
const { COMMANDS, ALIASES, canonico, handle, newSession } = await import('../../motor/mirante/sessao.ts')

const filhos: number[] = []
afterAll(() => {
  for (const p of filhos) { try { process.kill(-p, 'SIGKILL') } catch { try { process.kill(p, 'SIGKILL') } catch { void 0 } } }
  rmSync(BASE, { recursive: true, force: true })
})

function contrato(dev: string): void {
  mkdirSync(join(REPO, '.hii'), { recursive: true })
  const commands = { install: '', build: '', test: '', lint: '', typecheck: '', dev }
  writeFileSync(join(REPO, '.hii', 'contract.json'), JSON.stringify({
    version: 1, generated: '2026-09-12T00:00:00Z', hash: 'x', shape: 'single', packageManager: 'npm', monorepo: false, main: '', stack: 'js',
    packages: [{ name: 'app', path: '', framework: '', language: 'JavaScript', packageManager: 'npm', scripts: [], devPort: 0, commands }],
    commands, sources: [],
  }))
}

test('/serve e comando com apelidos /start, /dev e /preview, entra no autocompletar e vira o efeito servir', () => {
  expect(COMMANDS).toContain('/serve')
  expect(ALIASES['/serve']).toEqual(['/start', '/dev', '/preview'])
  expect(canonico('/start')).toBe('/serve')
  const r = handle('/dev 5 stop', newSession('org/app'))
  expect(r.effect).toMatchObject({ kind: 'servir', text: '5 stop' })
})

test('interpretarServe: sem argumento sobe o alvo padrao; id numerico mira um card; projeto forca o repo; stop/status trocam a acao; lixo pede ajuda', () => {
  expect(interpretarServe('')).toEqual({ acao: 'subir', alvo: '' })
  expect(interpretarServe('7')).toEqual({ acao: 'subir', alvo: '007' })
  expect(interpretarServe('projeto stop')).toEqual({ acao: 'parar', alvo: 'projeto' })
  expect(interpretarServe('status 12')).toEqual({ acao: 'status', alvo: '012' })
  expect(interpretarServe('banana')).toEqual({ acao: 'ajuda' })
  expect(interpretarServe('1 2')).toEqual({ acao: 'ajuda' })
})

test('resolverAlvo: dentro de uma tarefa com worktree o alvo e o card; card sem worktree explica e manda para o projeto; sem repo avisa', () => {
  const wt = join(BASE, 'wt-003')
  mkdirSync(wt, { recursive: true })
  const comWt = createCard({ title: 'a', status: 'PAUSED', repo: 'org/app', risk: 'low', worktree: wt }, '## Objetivo\nx\n')
  const semWt = createCard({ title: 'b', status: 'INBOX', repo: 'org/app', risk: 'low' }, '## Objetivo\ny\n')
  expect(resolverAlvo({ acao: 'subir', alvo: '' }, 'org/app', comWt)).toMatchObject({ kind: 'card', id: comWt, dir: wt })
  expect(resolverAlvo({ acao: 'subir', alvo: '' }, 'org/app', semWt), 'seguindo card sem worktree cai no projeto sem reclamar').toMatchObject({ kind: 'projeto', repo: 'org/app', dir: REPO })
  expect(String(resolverAlvo({ acao: 'subir', alvo: semWt }, 'org/app', ''))).toContain('nao tem worktree')
  expect(String(resolverAlvo({ acao: 'subir', alvo: 'projeto' }, '', ''))).toContain('/repo')
  expect(String(resolverAlvo({ acao: 'subir', alvo: '999' }, 'org/app', ''))).toContain('nao encontrado')
})

test('sem contrato, e depois sem commands.dev, o /serve diz exatamente o que falta em vez de tentar subir', async () => {
  expect((await comandoServir('projeto', 'org/app', '')).join(' ')).toContain('sem contrato')
  contrato('')
  expect((await comandoServir('projeto', 'org/app', '')).join(' ')).toContain('nao declara commands.dev')
  expect((await comandoServir('x y z', 'org/app', '')).join(' ')).toContain('uso: /serve')
})

test('/serve stop e status do projeto: com processo registrado e vivo, para e esquece o registro; sem nada, diz que estava parado', async () => {
  contrato('sleep 600')
  const filho = spawn('sleep', ['600'], { detached: true, stdio: 'ignore' })
  filho.unref()
  const pid = filho.pid ?? 0
  filhos.push(pid)
  mkdirSync(join(BASE, 'cards', 'urls', 'projeto'), { recursive: true })
  writeFileSync(join(BASE, 'cards', 'urls', 'projeto', 'org-app.json'), JSON.stringify({ repo: 'org/app', pid, port: 5200, iniciadoEm: '2026-09-12T00:00:00Z' }))
  expect(lerServidor('org/app')?.pid).toBe(pid)
  const status = await comandoServir('projeto status', 'org/app', '')
  expect(status.join(' ')).toContain(`pid ${pid}`)
  const parado = await comandoServir('projeto stop', 'org/app', '')
  expect(parado.join(' ')).toContain(`modo dev parado (pid ${pid})`)
  expect(existsSync(join(BASE, 'cards', 'urls', 'projeto', 'org-app.json'))).toBe(false)
  expect((await comandoServir('projeto stop', 'org/app', '')).join(' ')).toContain('nao havia modo dev')
})
