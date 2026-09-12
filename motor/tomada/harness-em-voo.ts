import { existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { cardsDir } from '../cordel/alicerce/config.ts'
import { isoNow } from '../cordel/index.ts'
import { patchCard, readCard } from '../cordel/store.ts'
import type { PapelDeChamada } from '../cordel/tipos.ts'

export interface HarnessRegistrado {
  pid: number
  papel: PapelDeChamada
  iniciadoEm: string
}

export interface RegistroDeCard {
  id: string
  registro: HarnessRegistrado
}

export type SinalDeEncerramento = 'SIGTERM' | 'SIGKILL'

export type ResultadoDeEncerramento =
  | { acao: 'sem-registro'; pid: 0 }
  | { acao: 'ja-morto'; pid: number }
  | { acao: 'recusado'; pid: number }
  | { acao: 'encerrado'; pid: number; sinal: SinalDeEncerramento }
  | { acao: 'sobreviveu'; pid: number }

export interface VarreduraDeHarnesses {
  mortosLimpos: string[]
  encerrados: Array<{ id: string; pid: number; sinal: SinalDeEncerramento }>
  deixados: string[]
  recusados: string[]
}

const SUFIXO = '.harness.pid'
const BINARIOS_DE_HARNESS: readonly string[] = ['claude', 'codex', 'kimi', 'curl']
const ESTADOS_SEM_HARNESS: readonly string[] = ['HALTED', 'PR_OPEN', 'MERGED', 'DEPLOYED']
export const ESPERA_SIGTERM_MS = 3000
const ESPERA_SIGKILL_MS = 1000
const PASSO_MS = 50

function pastaDeRuns(): string {
  return join(cardsDir(), 'runs')
}

function arquivoDeRegistro(id: string): string {
  return join(pastaDeRuns(), `${id}${SUFIXO}`)
}

export function registrarHarness(id: string, pid: number, papel: PapelDeChamada): void {
  if (!id || !pid) return
  const dir = pastaDeRuns()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const registro: HarnessRegistrado = { pid, papel, iniciadoEm: isoNow() }
  writeFileSync(arquivoDeRegistro(id), JSON.stringify(registro) + '\n')
}

export function lerHarness(id: string): HarnessRegistrado | null {
  try {
    const bruto = JSON.parse(readFileSync(arquivoDeRegistro(id), 'utf8')) as Partial<HarnessRegistrado>
    const pid = Number(bruto.pid)
    if (!Number.isInteger(pid) || pid <= 0) return null
    return { pid, papel: bruto.papel ?? 'desconhecido', iniciadoEm: String(bruto.iniciadoEm ?? '') }
  } catch {
    return null
  }
}

function apagarRegistro(id: string): void {
  try { rmSync(arquivoDeRegistro(id), { force: true }) } catch { void 0 }
}

export function esquecerHarness(id: string, pid: number): void {
  const atual = lerHarness(id)
  if (atual && atual.pid === pid) apagarRegistro(id)
}

export function harnessesRegistrados(): RegistroDeCard[] {
  const dir = pastaDeRuns()
  if (!existsSync(dir)) return []
  const saida: RegistroDeCard[] = []
  for (const nome of readdirSync(dir)) {
    if (!nome.endsWith(SUFIXO)) continue
    const id = nome.slice(0, -SUFIXO.length)
    const registro = lerHarness(id)
    if (registro) saida.push({ id, registro })
    else apagarRegistro(id)
  }
  return saida
}

function zumbi(pid: number): boolean {
  try {
    return /^State:\s+Z/m.test(readFileSync(`/proc/${pid}/status`, 'utf8'))
  } catch {
    return false
  }
}

export function pidVivo(pid: number): boolean {
  if (!pid) return false
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }
  return !zumbi(pid)
}

function cwdDoProcesso(pid: number): string {
  try {
    return readlinkSync(`/proc/${pid}/cwd`).replace(/ \(deleted\)$/, '')
  } catch {
    return ''
  }
}

function argvDoProcesso(pid: number): readonly string[] {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(p => p.length > 0)
  } catch {
    return []
  }
}

export function ehProcessoDeHarness(pid: number): boolean {
  return argvDoProcesso(pid).some(parte => BINARIOS_DE_HARNESS.includes(basename(parte)))
}

function rodaDentroDoWorktree(pid: number, worktree: string): boolean {
  if (!worktree) return false
  const cwd = cwdDoProcesso(pid)
  return cwd === worktree || cwd.startsWith(worktree.endsWith('/') ? worktree : `${worktree}/`)
}

export function identidadeProvada(pid: number, worktree: string): boolean {
  return rodaDentroDoWorktree(pid, worktree) || ehProcessoDeHarness(pid)
}

function esperarSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function esperarMorte(pid: number, tetoMs: number): boolean {
  const limite = Date.now() + tetoMs
  while (Date.now() < limite) {
    if (!pidVivo(pid)) return true
    esperarSync(PASSO_MS)
  }
  return !pidVivo(pid)
}

function sinalizar(pid: number, sinal: SinalDeEncerramento): void {
  try { process.kill(pid, sinal) } catch { void 0 }
}

export function matarComEscalada(pid: number): SinalDeEncerramento | 'sobreviveu' {
  sinalizar(pid, 'SIGTERM')
  if (esperarMorte(pid, ESPERA_SIGTERM_MS)) return 'SIGTERM'
  sinalizar(pid, 'SIGKILL')
  return esperarMorte(pid, ESPERA_SIGKILL_MS) ? 'SIGKILL' : 'sobreviveu'
}

function anotar(id: string, linha: string): void {
  try { patchCard(id, {}, `${isoNow()} ${linha}`) } catch { void 0 }
}

export function encerrarHarnessDoCard(id: string, contexto: string): ResultadoDeEncerramento {
  const registro = lerHarness(id)
  if (!registro) return { acao: 'sem-registro', pid: 0 }
  const { pid } = registro
  if (!pidVivo(pid)) {
    apagarRegistro(id)
    return { acao: 'ja-morto', pid }
  }
  const worktree = String(readCard(id)?.fm.worktree ?? '')
  if (!identidadeProvada(pid, worktree)) {
    apagarRegistro(id)
    anotar(id, `harness pid ${pid} registrado nao foi morto: o processo nao e o harness deste card (pid reciclado?) — registro descartado`)
    return { acao: 'recusado', pid }
  }
  const sinal = matarComEscalada(pid)
  if (sinal === 'sobreviveu') {
    anotar(id, `harness pid ${pid} NAO morreu nem com SIGKILL (${contexto}) — mate a mao`)
    return { acao: 'sobreviveu', pid }
  }
  apagarRegistro(id)
  anotar(id, `harness pid ${pid} encerrado (${sinal}) — ${contexto}`)
  return { acao: 'encerrado', pid, sinal }
}

function cardSemUsoDeHarness(id: string): boolean {
  const card = readCard(id)
  if (!card) return true
  return ESTADOS_SEM_HARNESS.includes(String(card.fm.status ?? ''))
}

export function varrerHarnessesOrfaos(): VarreduraDeHarnesses {
  const v: VarreduraDeHarnesses = { mortosLimpos: [], encerrados: [], deixados: [], recusados: [] }
  for (const { id, registro } of harnessesRegistrados()) {
    if (!pidVivo(registro.pid)) {
      apagarRegistro(id)
      v.mortosLimpos.push(id)
      continue
    }
    if (!cardSemUsoDeHarness(id)) {
      v.deixados.push(id)
      continue
    }
    const r = encerrarHarnessDoCard(id, 'orfao encontrado no arranque do motor, card ja nao roda')
    if (r.acao === 'encerrado') v.encerrados.push({ id, pid: r.pid, sinal: r.sinal })
    else if (r.acao === 'recusado') v.recusados.push(id)
  }
  return v
}

export function encerrarHarnessesRegistrados(contexto: string): Array<{ id: string } & ResultadoDeEncerramento> {
  const saida: Array<{ id: string } & ResultadoDeEncerramento> = []
  for (const { id } of harnessesRegistrados()) {
    saida.push({ id, ...encerrarHarnessDoCard(id, contexto) })
  }
  return saida
}
