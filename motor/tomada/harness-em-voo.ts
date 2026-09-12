import { existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { setTimeout as dormir } from 'node:timers/promises'
import { basename, join } from 'node:path'
import { cardsDir } from '../cordel/alicerce/config.ts'
import { isoNow } from '../cordel/index.ts'
import { patchCard, readCard } from '../cordel/store.ts'
import type { PapelDeChamada } from '../cordel/tipos.ts'

export interface HarnessRegistrado {
  pid: number
  papel: PapelDeChamada
  iniciadoEm: string
  inicioNoKernel: string
}

export interface RegistroDeCard {
  id: string
  registro: HarnessRegistrado
}

export type SinalDeEncerramento = 'SIGTERM' | 'SIGKILL'

export type ResultadoDeEncerramento =
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
const CAMPO_STARTTIME_APOS_COMM = 19

function pastaDeRuns(): string {
  return join(cardsDir(), 'runs')
}

function arquivoDeRegistro(id: string, pid: number): string {
  return join(pastaDeRuns(), `${id}.${pid}${SUFIXO}`)
}

export function inicioNoKernel(pid: number): string {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const aposComm = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    return aposComm[CAMPO_STARTTIME_APOS_COMM] ?? ''
  } catch {
    return ''
  }
}

export function registrarHarness(id: string, pid: number, papel: PapelDeChamada): void {
  if (!id || !pid) return
  const dir = pastaDeRuns()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const registro: HarnessRegistrado = { pid, papel, iniciadoEm: isoNow(), inicioNoKernel: inicioNoKernel(pid) }
  writeFileSync(arquivoDeRegistro(id, pid), JSON.stringify(registro) + '\n')
}

function lerRegistro(caminho: string): HarnessRegistrado | null {
  try {
    const bruto = JSON.parse(readFileSync(caminho, 'utf8')) as Partial<HarnessRegistrado>
    const pid = Number(bruto.pid)
    if (!Number.isInteger(pid) || pid <= 0) return null
    return { pid, papel: bruto.papel ?? 'desconhecido', iniciadoEm: String(bruto.iniciadoEm ?? ''), inicioNoKernel: String(bruto.inicioNoKernel ?? '') }
  } catch {
    return null
  }
}

function apagarRegistro(id: string, pid: number): void {
  try { rmSync(arquivoDeRegistro(id, pid), { force: true }) } catch { void 0 }
}

export function esquecerHarness(id: string, pid: number): void {
  apagarRegistro(id, pid)
}

function migrarRegistroDeSlotUnico(dir: string, nome: string): void {
  const antigo = join(dir, nome)
  const registro = lerRegistro(antigo)
  const id = nome.slice(0, -SUFIXO.length)
  try {
    if (registro) renameSync(antigo, arquivoDeRegistro(id, registro.pid))
    else rmSync(antigo, { force: true })
  } catch { void 0 }
}

function chaveDoArquivo(nome: string): { id: string; pid: number } | null {
  const chave = nome.slice(0, -SUFIXO.length)
  const ponto = chave.lastIndexOf('.')
  if (ponto < 0) return null
  const pid = Number(chave.slice(ponto + 1))
  return Number.isInteger(pid) && pid > 0 ? { id: chave.slice(0, ponto), pid } : null
}

export function harnessesRegistrados(): RegistroDeCard[] {
  const dir = pastaDeRuns()
  if (!existsSync(dir)) return []
  for (const nome of readdirSync(dir)) {
    if (nome.endsWith(SUFIXO) && !chaveDoArquivo(nome)) migrarRegistroDeSlotUnico(dir, nome)
  }
  const saida: RegistroDeCard[] = []
  for (const nome of readdirSync(dir)) {
    if (!nome.endsWith(SUFIXO)) continue
    const chave = chaveDoArquivo(nome)
    if (!chave) continue
    const registro = lerRegistro(join(dir, nome))
    if (registro && registro.pid === chave.pid) saida.push({ id: chave.id, registro })
    else try { rmSync(join(dir, nome), { force: true }) } catch { void 0 }
  }
  return saida
}

export function harnessesDoCard(id: string): HarnessRegistrado[] {
  return harnessesRegistrados().filter(r => r.id === id).map(r => r.registro)
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

export function mesmoProcesso(registro: HarnessRegistrado): boolean {
  if (!registro.inicioNoKernel) return true
  return inicioNoKernel(registro.pid) === registro.inicioNoKernel
}

export function identidadeProvada(registro: HarnessRegistrado, worktree: string): boolean {
  return mesmoProcesso(registro) && (rodaDentroDoWorktree(registro.pid, worktree) || ehProcessoDeHarness(registro.pid))
}

async function esperarMorte(pid: number, tetoMs: number): Promise<boolean> {
  const limite = Date.now() + tetoMs
  while (Date.now() < limite) {
    if (!pidVivo(pid)) return true
    await dormir(PASSO_MS)
  }
  return !pidVivo(pid)
}

function sinalizar(pid: number, sinal: SinalDeEncerramento): void {
  try { process.kill(pid, sinal) } catch { void 0 }
}

export async function matarComEscalada(registro: HarnessRegistrado): Promise<SinalDeEncerramento | 'sobreviveu'> {
  sinalizar(registro.pid, 'SIGTERM')
  if (await esperarMorte(registro.pid, ESPERA_SIGTERM_MS) || !mesmoProcesso(registro)) return 'SIGTERM'
  sinalizar(registro.pid, 'SIGKILL')
  return (await esperarMorte(registro.pid, ESPERA_SIGKILL_MS)) ? 'SIGKILL' : 'sobreviveu'
}

function anotar(id: string, linha: string): void {
  try { patchCard(id, {}, `${isoNow()} ${linha}`) } catch { void 0 }
}

function antesDeMatar(id: string, registro: HarnessRegistrado): ResultadoDeEncerramento | null {
  const { pid } = registro
  if (!pidVivo(pid)) {
    apagarRegistro(id, pid)
    return { acao: 'ja-morto', pid }
  }
  const worktree = String(readCard(id)?.fm.worktree ?? '')
  if (!identidadeProvada(registro, worktree)) {
    apagarRegistro(id, pid)
    anotar(id, `harness pid ${pid} registrado nao foi morto: o processo nao e o harness deste card (pid reciclado?) — registro descartado`)
    return { acao: 'recusado', pid }
  }
  return null
}

function depoisDeMatar(id: string, registro: HarnessRegistrado, sinal: SinalDeEncerramento | 'sobreviveu', contexto: string): ResultadoDeEncerramento {
  const { pid } = registro
  if (sinal === 'sobreviveu') {
    anotar(id, `harness pid ${pid} NAO morreu nem com SIGKILL (${contexto}) — mate a mao`)
    return { acao: 'sobreviveu', pid }
  }
  apagarRegistro(id, pid)
  anotar(id, `harness pid ${pid} encerrado (${sinal}) — ${contexto}`)
  return { acao: 'encerrado', pid, sinal }
}

async function encerrar(id: string, registro: HarnessRegistrado, contexto: string): Promise<ResultadoDeEncerramento> {
  return antesDeMatar(id, registro) ?? depoisDeMatar(id, registro, await matarComEscalada(registro), contexto)
}

export function encerrarHarnessDoCard(id: string, contexto: string): Promise<ResultadoDeEncerramento[]> {
  return Promise.all(harnessesDoCard(id).map(registro => encerrar(id, registro, contexto)))
}

export function harnessVivoDoCard(id: string): HarnessRegistrado | null {
  return harnessesDoCard(id).find(r => pidVivo(r.pid) && mesmoProcesso(r)) ?? null
}

export function motivoParaEsperarHarness(id: string): string {
  const vivo = harnessVivoDoCard(id)
  if (!vivo) return ''
  return `#${id}: o harness anterior (pid ${vivo.pid}, ${vivo.papel}) ainda esta encerrando — aguarde uns segundos e tente de novo, senao dois processos escrevem no mesmo worktree`
}

function cardSemUsoDeHarness(id: string): boolean {
  const card = readCard(id)
  if (!card) return true
  return ESTADOS_SEM_HARNESS.includes(String(card.fm.status ?? ''))
}

export async function varrerHarnessesOrfaos(): Promise<VarreduraDeHarnesses> {
  const v: VarreduraDeHarnesses = { mortosLimpos: [], encerrados: [], deixados: [], recusados: [] }
  for (const { id, registro } of harnessesRegistrados()) {
    if (!pidVivo(registro.pid)) {
      apagarRegistro(id, registro.pid)
      v.mortosLimpos.push(id)
      continue
    }
    if (!cardSemUsoDeHarness(id)) {
      v.deixados.push(id)
      continue
    }
    const r = await encerrar(id, registro, 'orfao encontrado no arranque do motor, card ja nao roda')
    if (r.acao === 'encerrado') v.encerrados.push({ id, pid: r.pid, sinal: r.sinal })
    else if (r.acao === 'recusado') v.recusados.push(id)
  }
  return v
}

export function encerrarHarnessesRegistrados(contexto: string): Promise<Array<{ id: string } & ResultadoDeEncerramento>> {
  return Promise.all(harnessesRegistrados().map(async ({ id, registro }) => ({ id, ...(await encerrar(id, registro, contexto)) })))
}
