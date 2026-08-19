import { readCard } from '../runner/card-store'
import * as core from './actions'
import { responder } from './responder'

export type AcaoDeTarefa = 'aprovar-url' | 'aprovar-plano' | 'recusar' | 'parar' | 'responder'

export interface ResultadoDeAcao {
  ok: boolean
  acao: AcaoDeTarefa
  id: string
  status: string
  mensagem: string
}

function statusDe(id: string): string {
  return String(readCard(id)?.fm.status ?? '')
}

function resultado(ok: boolean, acao: AcaoDeTarefa, id: string, mensagem: string): ResultadoDeAcao {
  return { ok, acao, id, status: statusDe(id), mensagem }
}

function aprovarUrl(id: string): ResultadoDeAcao {
  const r = core.approveUrl(id)
  return resultado(r.ok, 'aprovar-url', id, r.ok ? `#${id} url aprovado — segue para o polimento` : r.reason)
}

function aprovarPlano(id: string): ResultadoDeAcao {
  const r = core.approvePlan(id)
  return resultado(r.ok, 'aprovar-plano', id, r.ok ? `#${id} plano aprovado e na fila` : r.reason)
}

function recusar(id: string, motivo: string): ResultadoDeAcao {
  const r = core.rejectUrl(id, motivo)
  const feito = motivo ? `#${id} vai corrigir: ${motivo}` : `#${id} vai refazer do zero`
  return resultado(r.ok, 'recusar', id, r.ok ? feito : r.reason)
}

function parar(id: string, motivo: string): ResultadoDeAcao {
  const r = core.halt(id, motivo || 'parado pelo humano')
  return resultado(!!r, 'parar', id, r ? `#${id} parado` : `card #${id} nao encontrado`)
}

function responderPergunta(id: string, texto: string): ResultadoDeAcao {
  const r = responder(id, texto)
  const feito = r.restantes > 0
    ? `respondido: ${r.resposta} — faltam ${r.restantes} pergunta(s)`
    : `respondido: ${r.resposta} — #${id} retomado`
  return resultado(r.ok, 'responder', id, r.ok ? feito : r.reason)
}

export function executarAcao(acao: AcaoDeTarefa, id: string, texto = ''): ResultadoDeAcao {
  if (!id) return resultado(false, acao, id, 'diga o id da tarefa')
  if (acao === 'aprovar-url') return aprovarUrl(id)
  if (acao === 'aprovar-plano') return aprovarPlano(id)
  if (acao === 'recusar') return recusar(id, texto)
  if (acao === 'parar') return parar(id, texto)
  return responderPergunta(id, texto)
}
