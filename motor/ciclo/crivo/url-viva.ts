import { existsSync, mkdirSync, readlinkSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { isoNow } from '../../cordel/index.ts'
import { allCards, patchCard } from '../../cordel/store.ts'
import { cardsDir, ROOT, PREVIEW_BASE_PORT, URL_PROBE_INTERVAL_MS, URL_PROBE_TIMEOUT_MS, URL_INSPECT_TIMEOUT_MS, URL_FREEPORT_SETTLE_MS } from '../../cordel/alicerce/config.ts'
import { run } from '../../quilombo/git.ts'
import { readContract } from '../../cordel/bussola/armazenar.ts'
import { devCommand, devCwd, hasCommand } from '../../mirante/comandos.ts'
import { noProxyArgs } from '../../quilombo/alfandega/loopback.ts'
import { runtimeDeScript } from '../../cordel/alicerce/runtime.ts'

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
  await new Promise(r => setTimeout(r, URL_FREEPORT_SETTLE_MS))
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
  const r = await run('curl', probeArgs(url), { timeout: URL_PROBE_TIMEOUT_MS })
  return String(r.stdout || '').trim() === '200'
}

export async function waitHttp(url: string, tries: number): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    const r = await run('curl', probeArgs(url), { timeout: URL_PROBE_TIMEOUT_MS })
    if (String(r.stdout || '').trim() === '200') return true
    await new Promise(res => setTimeout(res, URL_PROBE_INTERVAL_MS))
  }
  return false
}

const ESTADOS_SEM_USO_DE_PREVIEW = ['PR_OPEN', 'MERGED', 'DEPLOYED', 'HALTED']

function cwdRealDoProcesso(pid: number): string {
  try {
    return readlinkSync(`/proc/${pid}/cwd`).replace(/ \(deleted\)$/, '')
  } catch {
    return ''
  }
}

export interface VarreduraDePreviews {
  mortosLimpos: string[]
  orfaosParados: string[]
}

export function varrerPreviewsOrfaos(): VarreduraDePreviews {
  const mortosLimpos: string[] = []
  const orfaosParados: string[] = []
  for (const c of allCards()) {
    const id = String(c.id ?? '')
    const pid = String(c.url_pid ?? '')
    if (!pid) continue
    if (!pidAlive(pid)) {
      patchCard(id, { url_pid: '' }, `${isoNow()} url_pid ${pid} apontava para processo morto — limpo no arranque`)
      mortosLimpos.push(id)
      continue
    }
    if (!ESTADOS_SEM_USO_DE_PREVIEW.includes(String(c.status ?? ''))) continue
    const worktree = String(c.worktree ?? '')
    const identidadeProvada = worktree !== '' && cwdRealDoProcesso(Number(pid)).startsWith(worktree)
    if (!identidadeProvada) continue
    stopUrl(pid)
    patchCard(id, { url_pid: '' }, `${isoNow()} preview orfao (pid ${pid}) parado no arranque — card em ${c.status} nao usa mais o preview`)
    orfaosParados.push(id)
  }
  return { mortosLimpos, orfaosParados }
}

export async function inspectUrl(id: string, url: string, capture: boolean): Promise<UrlHealth> {
  const dir = join(cardsDir(), 'urls', String(id))
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const out = capture ? join(dir, 'url.png') : ''
  const r = await run(runtimeDeScript(), [join(ROOT, 'scripts', 'inspect-preview.mjs'), url, out], { cwd: ROOT, timeout: URL_INSPECT_TIMEOUT_MS })
  try {
    const j = JSON.parse(String(r.stdout || '')) as { ok?: boolean; conclusive?: boolean; detail?: string }
    return { ok: !!j.ok, conclusive: !!j.conclusive, detail: String(j.detail || '') }
  } catch {
    return { ok: false, conclusive: false, detail: 'inspecao do url nao concluida (playwright ausente ou pagina inacessivel)' }
  }
}
