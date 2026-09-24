import type { Harness } from './tipos.ts'

const porServidor = new Map<string, number>()
const porModelo = new Map<string, number>()

export type AdmissaoDeInferencia =
  | { admitida: true; liberar: () => void; servidor: string; modelo: string }
  | { admitida: false; motivo: string; servidor: string; modelo: string }

export interface SituacaoDaInferencia {
  servidor: string; modelo: string; limiteServidor: number; limiteModelo: number
  emUsoNoServidor: number; emUsoNoModelo: number; disponivel: boolean; configuracaoValida: boolean
}

export function situacaoDaInferencia(harness: Harness, modelo: string | undefined): SituacaoDaInferencia | null {
  const recurso = harness.recursoDeInferencia?.(modelo)
  if (!recurso) return null
  const nomeDoModelo = recurso.modelo || 'padrao'
  const chaveModelo = `${recurso.servidor}\n${nomeDoModelo}`
  const configuracaoValida = !!recurso.servidor && Number.isSafeInteger(recurso.slotsServidor) && recurso.slotsServidor >= 1 && recurso.slotsServidor <= 64 &&
    Number.isSafeInteger(recurso.slotsModelo) && recurso.slotsModelo >= 1 && recurso.slotsModelo <= recurso.slotsServidor
  const emUsoNoServidor = porServidor.get(recurso.servidor) ?? 0
  const emUsoNoModelo = porModelo.get(chaveModelo) ?? 0
  return { servidor: recurso.servidor, modelo: nomeDoModelo, limiteServidor: recurso.slotsServidor, limiteModelo: recurso.slotsModelo,
    emUsoNoServidor, emUsoNoModelo, configuracaoValida,
    disponivel: configuracaoValida && emUsoNoServidor < recurso.slotsServidor && emUsoNoModelo < recurso.slotsModelo }
}

export function admitirInferencia(harness: Harness, modelo: string | undefined): AdmissaoDeInferencia {
  const situacao = situacaoDaInferencia(harness, modelo)
  if (!situacao) return { admitida: true, liberar: () => {}, servidor: '', modelo: '' }
  const { servidor } = situacao
  const nomeDoModelo = situacao.modelo
  if (!situacao.configuracaoValida) return { admitida: false, servidor, modelo: nomeDoModelo, motivo: 'configuracao invalida da capacidade de inferencia' }
  const chaveModelo = `${servidor}\n${nomeDoModelo}`
  if (!situacao.disponivel) {
    return { admitida: false, servidor, modelo: nomeDoModelo, motivo: `server is busy; capacidade de inferencia ocupada para ${nomeDoModelo}` }
  }
  porServidor.set(servidor, (porServidor.get(servidor) ?? 0) + 1)
  porModelo.set(chaveModelo, (porModelo.get(chaveModelo) ?? 0) + 1)
  let liberada = false
  return { admitida: true, servidor, modelo: nomeDoModelo, liberar: () => {
    if (liberada) return
    liberada = true
    const servidorRestante = (porServidor.get(servidor) ?? 1) - 1
    const modeloRestante = (porModelo.get(chaveModelo) ?? 1) - 1
    if (servidorRestante) porServidor.set(servidor, servidorRestante); else porServidor.delete(servidor)
    if (modeloRestante) porModelo.set(chaveModelo, modeloRestante); else porModelo.delete(chaveModelo)
  } }
}

export function ocupacaoDaInferencia(): { servidores: number; modelos: number; chamadas: number } {
  return { servidores: porServidor.size, modelos: porModelo.size, chamadas: [...porServidor.values()].reduce((s, n) => s + n, 0) }
}
