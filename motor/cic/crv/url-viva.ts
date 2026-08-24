import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { cardsDir, ROOT, PREVIEW_BASE_PORT } from '../../cdl/ali/config'
import { run } from '../../qlb/git'
import { readContract } from '../../cdl/bss/armazenar'
import { devCommand, devCwd, hasCommand } from '../../mir/comandos'
import { noProxyArgs } from '../../qlb/alf/loopback'

export interface UrlHealth {
  ok: boolean
  conclusive: boolean
  detail: string
}

export function urlPort(id: string): number {
  return PREVIEW_BASE_PORT + (Number(id) || 0)
}

export function hasDevServer(target: string): boolean {
  return hasCommand(readContract(target), 'dev')
}

export async function freePort(port: number): Promise<void> {
  await run('bash', ['-c', `fuser -k ${port}/tcp 2>/dev/null; exit 0`], { timeout: 8000 })
  await new Promise(r => setTimeout(r, 400))
}

export function startUrl(wt: string, port: number, target: string): number {
  const contract = readContract(target)
  if (!contract) return 0
  const cmd = devCommand(contract, port)
  if (!cmd) return 0
  const child = spawn(cmd.cmd, cmd.args, { cwd: devCwd(contract, wt), detached: true, stdio: 'ignore' })
  child.unref()
  return child.pid || 0
}

export function pidAlive(pid: string | undefined): boolean {
  const n = Number(pid)
  if (!n) return false
  try {
    process.kill(n, 0)
    return true
  } catch {
    return false
  }
}

export interface UrlHandle {
  pid: number
  reused: boolean
}

export async function ensureUrl(wt: string, port: number, target: string, knownPid?: string): Promise<UrlHandle> {
  if (pidAlive(knownPid) && await httpOk(`http://localhost:${port}`)) {
    return { pid: Number(knownPid), reused: true }
  }
  await freePort(port)
  return { pid: startUrl(wt, port, target), reused: false }
}

export function stopUrl(pid: string | undefined): void {
  const n = Number(pid)
  if (!n) return
  try {
    process.kill(-n, 'SIGTERM')
  } catch {
    try { process.kill(n, 'SIGTERM') } catch { void 0 }
  }
}

export function probeArgs(url: string): string[] {
  return ['-q', ...noProxyArgs(url), '-s', '-o', '/dev/null', '-w', '%{http_code}', url]
}

export async function httpOk(url: string): Promise<boolean> {
  const r = await run('curl', probeArgs(url), { timeout: 4000 })
  return String(r.stdout || '').trim() === '200'
}

export async function waitHttp(url: string, tries: number): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    const r = await run('curl', probeArgs(url), { timeout: 5000 })
    if (String(r.stdout || '').trim() === '200') return true
    await new Promise(res => setTimeout(res, 1000))
  }
  return false
}

export async function inspectUrl(id: string, url: string, capture: boolean): Promise<UrlHealth> {
  const dir = join(cardsDir(), 'urls', String(id))
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const out = capture ? join(dir, 'url.png') : ''
  const r = await run('bun', [join(ROOT, 'scripts', 'inspect-preview.mjs'), url, out], { cwd: ROOT, timeout: 60000 })
  try {
    const j = JSON.parse(String(r.stdout || '')) as { ok?: boolean; conclusive?: boolean; detail?: string }
    return { ok: !!j.ok, conclusive: !!j.conclusive, detail: String(j.detail || '') }
  } catch {
    return { ok: false, conclusive: false, detail: 'inspecao do url nao concluida (playwright ausente ou pagina inacessivel)' }
  }
}
