import type { SessaoHii } from '../euclides/sessoes.ts'
import type { SnapshotDoMotor } from '../mirante/estado-json.ts'
import type { AcaoApi, Json } from './contrato.ts'
import type { ProvedorDisponivel } from '../tomada/disponibilidade.ts'
import type { RevisaoDePlano } from '../oswaldo/orquestracao/planos.ts'
import type { RelatorioDeEvidencias } from '../oswaldo/orquestracao/evidencias.ts'
import type { Escopo, Evento, Snapshot, Recurso as RecursoObservavel } from '../observabilidade/contrato.ts'
import { Projecao } from '../observabilidade/projecao.ts'

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
  function filtroQuery(filtro: Partial<Escopo>): string {
    return new URLSearchParams(Object.entries(filtro).filter(([, v]) => !!v)).toString()
  }
  const observarSnapshot = (filtro: Partial<Escopo> = {}, depois = '', signal?: AbortSignal) => get<Snapshot>(`/v1/observabilidade/snapshot?${filtroQuery(filtro)}&depois=${encodeURIComponent(depois)}`, signal)
  function observar(filtro: Partial<Escopo>, receber: (p: Projecao) => void, falhar: (e: Error) => void = () => {}): { dispose: () => void; concluido: Promise<void> } {
    const controle = new AbortController()
    const projecao = new Projecao()
    const concluido = (async () => {
      while (!controle.signal.aborted) {
        try {
          const primeiro = (await observarSnapshot(filtro, '', controle.signal)).valor
          let pagina = primeiro
          const atividades = [...primeiro.atividades]
          while (pagina.proxima) { pagina = (await observarSnapshot(filtro, pagina.proxima, controle.signal)).valor; atividades.push(...pagina.atividades) }
          projecao.reconstruir({ ...primeiro, atividades })
          receber(projecao)
          // Reconcilia periodicamente mesmo sem eventos; nao executa POST.
          const prazo = AbortSignal.timeout(30000)
          const signal = AbortSignal.any([controle.signal, prazo])
          const r = await chamar(`/v1/observabilidade/eventos?${filtroQuery(filtro)}`, { signal, headers: { 'last-event-id': projecao.cursor } })
          if (!r.body) throw new Error('stream sem corpo')
          const leitor = r.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          try {
            while (!signal.aborted) {
              const parte = await leitor.read()
              if (parte.done) break
              buffer += decoder.decode(parte.value, { stream: true })
              if (buffer.length > 1048576) throw new Error('evento excede limite')
              let fim = buffer.indexOf('\n\n')
              while (fim >= 0) {
                const bloco = buffer.slice(0, fim)
                buffer = buffer.slice(fim + 2)
                const linhas = bloco.split('\n')
                const tipo = linhas.find(l => l.startsWith('event: '))?.slice(7)
                if (tipo === 'reset') throw new Error('snapshot requerido')
                if (tipo === 'activity' || tipo === 'output') {
                  const dados = linhas.filter(l => l.startsWith('data: ')).map(l => l.slice(6)).join('\n')
                  projecao.aplicar(JSON.parse(dados) as Evento)
                  receber(projecao)
                }
                fim = buffer.indexOf('\n\n')
              }
            }
          } finally { await leitor.cancel().catch(() => {}); leitor.releaseLock() }
        } catch (e) { if (!controle.signal.aborted && (e as Error).name !== 'TimeoutError') falhar(e as Error) }
        if (!controle.signal.aborted) await new Promise<void>(resolve => {
          const fechar = (): void => { clearTimeout(timer); controle.signal.removeEventListener('abort', fechar); resolve() }
          const timer = setTimeout(fechar, 1000)
          controle.signal.addEventListener('abort', fechar, { once: true })
        })
      }
    })()
    return { dispose: () => controle.abort(), concluido }
  }
  return {
    observarSnapshot,
    observar,
    catalogoObservabilidade: (repo = '', depois = '') => get<{ versao: 1; recursos: RecursoObservavel[]; proxima: string | null }>(`/v1/observabilidade/recursos?repo=${encodeURIComponent(repo)}&depois=${encodeURIComponent(depois)}`),
    historico: (id: string, offset = 0) => get<{ eventos: object[]; proximo: number; fim: boolean }>(`/v1/tarefas/${idSeguro(id)}/historico?offset=${offset}`),
    configuracao: () => get<{ versao: 1; preferencias: object }>('/v1/configuracao'),
    configurar: (ajuste: { versao: 1; papel: string; provider?: string; model?: string; effort?: string; modo?: string; gauntlet?: boolean }, chave: string, etag: string) => post<Json>('/v1/configuracao', ajuste, chave, etag),
    perguntar: (repo: string, pergunta: string, chave: string, sessao?: string) => post<{ id: string; atividade: string; estado: string }>('/v1/ask', { repo, pergunta, ...(sessao ? { sessao } : {}) }, chave),
    consulta: (id: string) => get<{ id: string; repo: string; estado: string; resposta: string; custoUsd: number | null }>(`/v1/consultas/${encodeURIComponent(id)}`),
    revisarPlano: (id: string, plano: object, revisaoEsperada: number, chave: string, etag: string) => post<Json>(`/v1/tarefas/${idSeguro(id)}/plano`, { plano, revisaoEsperada }, chave, etag),
    artefatos: (id: string) => get<{ artefatos: object[] }>(`/v1/tarefas/${idSeguro(id)}/artefatos`),
    artefato: (id: string) => get<{ id: string; nome: string; tipo: string; tamanho: number; sha256: string; conteudo: string }>(`/v1/artefatos/${encodeURIComponent(id)}`),
    perguntas: (id: string) => get<{ perguntaId: string | null; pendencia: { origem: string; indice: number; atual: { q: string; options: string[]; recommended?: string } } | null }>(`/v1/tarefas/${idSeguro(id)}/perguntas`),
    responderPergunta: (id: string, perguntaId: string, texto: string, chave: string, etag: string) => post<Json>(`/v1/tarefas/${idSeguro(id)}/respostas`, { perguntaId, texto }, chave, etag),
    capacidades: () => get<{ protocolo: string; versao: number; statuses: string[]; acoes: string[]; eventos: string[]; observabilidade?: { versoes: number[] } }>('/v1/capacidades'),
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
