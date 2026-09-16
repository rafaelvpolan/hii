import type { SessaoHii } from '../euclides/sessoes.ts'
import type { SnapshotDoMotor } from '../mirante/estado-json.ts'
import type { AcaoApi, Json } from './contrato.ts'
import type { ProvedorDisponivel } from '../tomada/disponibilidade.ts'
import type { RevisaoDePlano } from '../oswaldo/orquestracao/planos.ts'
import type { RelatorioDeEvidencias } from '../oswaldo/orquestracao/evidencias.ts'

export type PedidoHicode = { modo: 'gateway' | 'orquestrador'; texto: string }
  | { modo: 'orquestrador'; spec: { nome: string; conteudo: string } }
export interface PedidoCriado { id: string; sessao: string; modo: 'gateway' | 'orquestrador'; status: string; enfileirada: boolean; mensagem: string }
export interface Recurso<T> { valor: T; etag: string }
export class ErroMotorHttp extends Error {
  readonly status: number
  readonly corpo: string
  constructor(status: number, corpo: string) {
    super(`HII respondeu HTTP ${status}`)
    this.status = status
    this.corpo = corpo
  }
}

// Adaptador server-side: token nunca vai ao bundle do navegador. Nao faz retries
// implicitos; o chamador preserva a chave da mesma intencao apos queda de rede.
export function clienteHii(base: string, token: string) {
  const url = new URL(base)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('URL do motor invalida')
  const origem = base.replace(/\/$/, '')
  async function chamar(caminho: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('authorization', `Bearer ${token}`)
    if (init.body) headers.set('content-type', 'application/json')
    const r = await fetch(`${origem}${caminho}`, { ...init, headers, redirect: 'error' })
    if (!r.ok) throw new ErroMotorHttp(r.status, (await r.text()).slice(0, 4096))
    return r
  }
  async function get<T>(caminho: string, signal?: AbortSignal): Promise<Recurso<T>> {
    const r = await chamar(caminho, { signal: signal ?? AbortSignal.timeout(15000) })
    return { valor: await r.json() as T, etag: r.headers.get('etag') ?? '' }
  }
  async function post<T>(caminho: string, corpo: object, chave: string, etag = ''): Promise<Recurso<T>> {
    const r = await chamar(caminho, {
      method: 'POST', body: JSON.stringify(corpo), signal: AbortSignal.timeout(15000),
      headers: { 'idempotency-key': chave, ...(etag ? { 'if-match': etag } : {}) },
    })
    return { valor: await r.json() as T, etag: r.headers.get('etag') ?? '' }
  }
  function idSeguro(id: string): string {
    if (!/^\d{3,12}$/.test(id)) throw new Error('ID invalido')
    return id
  }
  return {
    capacidades: () => get<{ protocolo: string; versao: number; statuses: string[]; acoes: string[]; eventos: string[] }>('/v1/capacidades'),
    provedores: () => get<{ provedores: (ProvedorDisponivel & { modelos: string[] })[] }>('/v1/provedores'),
    estado: (repo = '') => get<SnapshotDoMotor & { cursor: string }>(`/v1/estado?repo=${encodeURIComponent(repo)}`),
    novaSessao: (repo: string, titulo: string, chave: string) => post<SessaoHii>('/v1/sessoes', { repo, titulo }, chave),
    sessao: (id: string) => get<SessaoHii>(`/v1/sessoes/${idSeguro(id)}`),
    pedido: (id: string, pedido: PedidoHicode, chave: string) => post<PedidoCriado>(`/v1/sessoes/${idSeguro(id)}/pedidos`, pedido, chave),
    tarefa: (id: string) => get<{ etag: string; campos: Record<string, string>; objetivo: string }>(`/v1/tarefas/${idSeguro(id)}`),
    plano: (id: string) => get<{ plano: RevisaoDePlano | null; evidencias: RelatorioDeEvidencias | null; atualidadeVerificada: false }>(`/v1/tarefas/${idSeguro(id)}/plano`),
    agir: (id: string, acao: AcaoApi, texto: string, chave: string, etag: string) => post<Json>(`/v1/tarefas/${idSeguro(id)}/acoes`, { acao, ...(texto ? { texto } : {}) }, chave, etag),
    fechar: (id: string, chave: string, etag: string) => post<SessaoHii>(`/v1/sessoes/${idSeguro(id)}/fechar`, {}, chave, etag),
    log: (id: string, offset = 0) => get<{ texto: string; proximo: number; reset: boolean }>(`/v1/tarefas/${idSeguro(id)}/log?offset=${offset}`),
    recursos: (repo: string) => get<{ provedor: string; comandos: { comando: string; descricao: string; origem?: string }[] }>(`/v1/recursos?repo=${encodeURIComponent(repo)}`),
    eventos: (cursor = '', signal?: AbortSignal) => chamar('/v1/eventos', { signal, headers: { accept: 'text/event-stream', ...(cursor ? { 'last-event-id': cursor } : {}) } }),
  }
}
