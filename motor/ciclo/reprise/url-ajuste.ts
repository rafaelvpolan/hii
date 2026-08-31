import { numeroDeEnv, URL_WAIT_S } from '../../cordel/alicerce/config.ts'
import { ensureUrl, waitHttp } from '../crivo/url-viva.ts'
import { anexarEvento } from '../../euclides/eventos.ts'

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

export function instrucaoDeConserto(detalhe: string): string {
  return [
    `A url subiu, mas a pagina deu erro: ${detalhe || 'erro nao detalhado'}.`,
    'Conserte APENAS o que quebra a pagina — erro de runtime, import faltando, chamada quebrada.',
    'Nao mude o comportamento entregue pela tarefa nem refaca o trabalho.',
    'Ao terminar, diga em uma linha o que consertou.',
  ].join(' ')
}

export function instrucaoDeAjuste(porta: number, tentativa: number): string {
  return [
    `A url do resultado nao subiu em http://localhost:${porta} (tentativa ${tentativa}).`,
    'Ajuste APENAS o que impede a url de responder: comando de dev, porta, host, variavel de ambiente,',
    'dependencia faltando ou erro de arranque. Nao mude o comportamento entregue pela tarefa.',
    'Ao terminar, diga em uma linha o que ajustou.',
  ].join(' ')
}

// Recebe o card para escrever no diario. Este era o unico dos quatro laços de
// reparo do motor que nao registrava tentativa nenhuma: se o processo caisse no
// meio de um ajuste de URL, a retomada nao tinha como saber que ja houve
// tentativa, e o `aprendiz` (item 12) nao veria a recorrencia. Os outros tres
// (repararAteOTeto, runGatedStep e os portoes de build/teste) ja registram.
export async function subirUrlComAjuste(deps: DepsDoAjuste, pidConhecido?: string, card = ''): Promise<TentativaDeUrl> {
  const ajustes: string[] = []
  let pid = await deps.subir(pidConhecido)
  let noAr = pid ? await deps.responde(pid) : false
  let tentativas = 1
  while (!noAr && tentativas <= TENTATIVAS_DE_AJUSTE) {
    const motivo = pid ? 'subiu mas nao respondeu' : 'nao subiu'
    if (card) anexarEvento({ card, evento: 'repair_attempt', fase: 'url', detalhe: `tentativa ${tentativas}/${TENTATIVAS_DE_AJUSTE}: ${motivo}` })
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

export function esperarPorPid(porta: number, segundos = URL_WAIT_S): (pid: number) => Promise<boolean> {
  return async (pid: number): Promise<boolean> => (pid ? waitHttp(`http://localhost:${porta}`, segundos) : false)
}

export function subirNoWorktree(wt: string, porta: number, target: string): (pidConhecido?: string) => Promise<number> {
  return async (pidConhecido?: string): Promise<number> => (await ensureUrl(wt, porta, target, pidConhecido)).pid
}
