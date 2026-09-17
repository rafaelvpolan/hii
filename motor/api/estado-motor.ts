import { readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { cardsDir } from '../cordel/alicerce/config.ts'
import { alive } from '../oswaldo/mutirao/daemon.ts'
import { lockFile } from '../oswaldo/mutirao/trava-instancia.ts'
import { encerrando } from '../oswaldo/mutirao/encerramento.ts'
import { lerSaude } from '../euclides/radar/servidor.ts'

export interface EstadoMotor {
  protocolo: 1
  estado: 'ligado' | 'desligado' | 'degradado' | 'desconhecido'
  versao: string
  versaoEmExecucao: string | null
  fila: string
  consultadoEm: string
  motivo: string
}
interface Presenca { pid: number; versao: string; fila: string; atualizado: number; pronto: boolean }
export function identidadeDaFila(diretorio = cardsDir()): string {
  let caminho = resolve(diretorio)
  try { caminho = realpathSync(caminho) } catch { /* fila ainda nao provisionada */ }
  return createHash('sha256').update(caminho).digest('hex')
}
export function versaoDoMotor(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version?: string }
    return pkg.version || 'desconhecida'
  } catch { return 'desconhecida' }
}
const VERSAO_EM_EXECUCAO = versaoDoMotor()
function arquivo(): string { return lockFile() + '.estado.json' }
export function publicarPresenca(): void {
  const saude = lerSaude()
  const registro: Presenca = { pid: process.pid, versao: VERSAO_EM_EXECUCAO, fila: identidadeDaFila(), atualizado: Date.now(), pronto: saude.ok && !encerrando() }
  const destino = arquivo()
  const temporario = destino + '.' + process.pid + '.tmp'
  writeFileSync(temporario, JSON.stringify(registro), { mode: 0o600 })
  renameSync(temporario, destino)
}
export function acompanharPresenca(): () => void {
  const publicar = (): void => {
    try { publicarPresenca() } catch { /* observabilidade indisponivel nao interrompe a fila */ }
  }
  publicar()
  const timer = setInterval(publicar, 2000)
  timer.unref()
  return () => clearInterval(timer)
}
export function estadoMotor(): EstadoMotor {
  const base: EstadoMotor = {
    protocolo: 1, estado: 'desconhecido', versao: versaoDoMotor(), versaoEmExecucao: null,
    fila: identidadeDaFila(), consultadoEm: new Date().toISOString(), motivo: '',
  }
  let pid: number
  try { pid = Number(readFileSync(lockFile(), 'utf8').trim()) }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ...base, estado: 'desligado', motivo: 'Daemon de execucao desligado; API acessivel.' }
    return { ...base, motivo: 'Nao foi possivel consultar o registro do daemon.' }
  }
  if (!Number.isSafeInteger(pid) || pid <= 0) return { ...base, motivo: 'Registro do daemon invalido.' }
  if (!alive(pid)) return { ...base, estado: 'desligado', motivo: 'Processo do daemon encerrado.' }
  try {
    const p = JSON.parse(readFileSync(arquivo(), 'utf8')) as Presenca
    if (p.pid !== pid || !Number.isFinite(p.atualizado) || Date.now() - p.atualizado > 10000 || p.atualizado > Date.now() + 1000) {
      return { ...base, motivo: 'Daemon sem confirmacao recente; verifique a instalacao ou bloqueio do processo.' }
    }
    if (p.fila !== base.fila) return { ...base, motivo: 'API e daemon configurados para filas diferentes.' }
    if (typeof p.versao !== 'string' || typeof p.pronto !== 'boolean') return { ...base, motivo: 'Registro de presenca invalido.' }
    return { ...base, versaoEmExecucao: p.versao, estado: p.pronto ? 'ligado' : 'degradado', motivo: p.pronto ? 'Daemon ligado e respondendo.' : 'Daemon ligado, mas sem disponibilidade para novos trabalhos.' }
  } catch { return { ...base, motivo: 'Daemon sem registro de presenca; atualize ou confira o motor.' } }
}
