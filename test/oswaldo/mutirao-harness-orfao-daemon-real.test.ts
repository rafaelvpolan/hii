import { test, expect, afterAll, rodar, dormir } from '../apoio/runner.ts'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TEMPO_COM_GIT_MS } from '../tempo-de-teste.ts'

const REPO = join(import.meta.dirname, '..', '..')
const BASE = mkdtempSync(join(tmpdir(), 'hicode-harness-orfao-'))
const CARDS = join(BASE, 'cards')
const WT = join(BASE, 'wt')
mkdirSync(join(CARDS, 'runs'), { recursive: true })
mkdirSync(join(WT, '.git'), { recursive: true })
process.env.HICODE_CARDS_DIR = CARDS

const { createCard, readCard } = await import('../../motor/cordel/store.ts')

const filhos: ChildProcess[] = []
afterAll(() => {
  for (const f of filhos) { try { f.kill('SIGKILL') } catch { void 0 } }
  rmSync(BASE, { recursive: true, force: true })
})

function teimoso(): number {
  const filho = spawn('bash', ['-c', "trap '' TERM; sleep 120"], { cwd: WT, stdio: 'ignore' })
  filhos.push(filho)
  return filho.pid ?? 0
}

function vivo(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function registrar(id: string, pid: number): void {
  writeFileSync(join(CARDS, 'runs', `${id}.harness.pid`), JSON.stringify({ pid, papel: 'implement', iniciadoEm: new Date().toISOString() }))
}

function ambiente(): Record<string, string> {
  return {
    ...process.env as Record<string, string>,
    HICODE_CARDS_DIR: CARDS,
    HICODE_REPOS_FILE: join(BASE, 'repos.json'),
    HICODE_RUNNER_PIDFILE: join(BASE, 'runner.pid'),
    HICODE_RUNNER_LOCK: join(BASE, 'runner.lock'),
    HICODE_CONCURRENCY: '0',
    HICODE_POLL_MS: '1000',
  }
}

async function esperar(cond: () => boolean, tetoMs: number): Promise<boolean> {
  const limite = Date.now() + tetoMs
  while (Date.now() < limite) {
    if (cond()) return true
    await dormir(50)
  }
  return cond()
}

test('REGRESSAO daemon real: arranque encerra harness orfao de card HALTED; SIGTERM encerra o restante antes de sair', async () => {
  const parado = createCard({ status: 'HALTED', halt_class: 'humano', title: 'a', repo: 'org/app', risk: 'low', worktree: WT }, '## Objetivo\nx\n')
  const pausado = createCard({ status: 'PAUSED', title: 'b', repo: 'org/app', risk: 'low', worktree: WT }, '## Objetivo\ny\n')
  const pidParado = teimoso()
  const pidPausado = teimoso()
  await dormir(150)
  registrar(parado, pidParado)
  registrar(pausado, pidPausado)

  const proc = rodar(['bun', 'runner.ts'], { cwd: REPO, env: ambiente() })
  const log = (): string => proc.saidaPadrao()
  const subiu = await esperar(() => log().includes('runner ativo'), 20_000)
  expect(subiu, `daemon nao subiu. log:\n${log()}`).toBe(true)

  expect(await esperar(() => !vivo(pidParado), 5000), 'harness do card HALTED tinha de morrer no arranque').toBe(true)
  const linhaDoArranque = `#${parado}: harness orfao (pid ${pidParado}) encerrado no arranque`
  expect(await esperar(() => log().includes(linhaDoArranque), 2000), `a varredura e assincrona: a linha chega logo depois da morte. log:\n${log()}`).toBe(true)
  expect(readCard(parado)?.body ?? '').toContain(`harness pid ${pidParado} encerrado (SIGKILL)`)
  expect(existsSync(join(CARDS, 'runs', `${parado}.harness.pid`))).toBe(false)
  expect(vivo(pidPausado), 'card que nao esta terminal mantem o harness no arranque').toBe(true)

  proc.kill('SIGTERM')
  await proc.encerrou
  expect(await esperar(() => !vivo(pidPausado), 5000), `harness registrado sobreviveu ao encerramento do daemon. log:\n${log()}`).toBe(true)
  expect(log()).toContain(`harness pid ${pidPausado} encerrado`)
  expect(readCard(pausado)?.body ?? '').toContain(`harness pid ${pidPausado} encerrado (SIGKILL)`)
  expect(existsSync(join(CARDS, 'runs', `${pausado}.harness.pid`))).toBe(false)
  expect(proc.exitCode).toBe(0)
}, TEMPO_COM_GIT_MS * 2)
