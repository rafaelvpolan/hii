import { numeroDeEnv } from './config'
import { ensureUrl, waitHttp } from './url-vivo'

export const TENTATIVAS_DE_AJUSTE = numeroDeEnv('HICODE_URL_AJUSTES', 2)

export interface TentativaDeUrl {
  pid: number
  noAr: boolean
  tentativas: number
  ajustes: string[]
}

export interface DepsDoAjuste {
  subir: (pidConhecido?: string) => Promise<number>
  responde: (pid: number) => Promise<boolean>
  ajustar: (motivo: string, tentativa: number) => Promise<string>
}

export function instrucaoDeAjuste(porta: number, tentativa: number): string {
  return [
    `A url do resultado nao subiu em http://localhost:${porta} (tentativa ${tentativa}).`,
    'Ajuste APENAS o que impede a url de responder: comando de dev, porta, host, variavel de ambiente,',
    'dependencia faltando ou erro de arranque. Nao mude o comportamento entregue pela tarefa.',
    'Ao terminar, diga em uma linha o que ajustou.',
  ].join(' ')
}

export async function subirUrlComAjuste(deps: DepsDoAjuste, pidConhecido?: string): Promise<TentativaDeUrl> {
  const ajustes: string[] = []
  let pid = await deps.subir(pidConhecido)
  let noAr = pid ? await deps.responde(pid) : false
  let tentativas = 1
  while (!noAr && tentativas <= TENTATIVAS_DE_AJUSTE) {
    const motivo = pid ? 'subiu mas nao respondeu' : 'nao subiu'
    ajustes.push(await deps.ajustar(motivo, tentativas))
    pid = await deps.subir()
    noAr = pid ? await deps.responde(pid) : false
    tentativas += 1
  }
  return { pid, noAr, tentativas, ajustes }
}

export function relatoDoAjuste(t: TentativaDeUrl): string {
  if (t.noAr && t.ajustes.length === 0) return 'url no ar de primeira'
  if (t.noAr) return `url no ar depois de ${t.ajustes.length} ajuste(s): ${t.ajustes.filter(Boolean).join(' · ')}`
  return `url nao subiu depois de ${t.ajustes.length} ajuste(s) — precisa de olho humano`
}

export function esperarPorPid(porta: number, segundos = 30): (pid: number) => Promise<boolean> {
  return async (pid: number): Promise<boolean> => (pid ? waitHttp(`http://localhost:${porta}`, segundos) : false)
}

export function subirNoWorktree(wt: string, porta: number, target: string): (pidConhecido?: string) => Promise<number> {
  return async (pidConhecido?: string): Promise<number> => (await ensureUrl(wt, porta, target, pidConhecido)).pid
}
