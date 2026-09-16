import type { IncomingMessage, ServerResponse } from 'node:http'
import { snapshot, eventos, recurso } from '../observabilidade/registro.ts'
import type { Escopo } from '../observabilidade/contrato.ts'
import { comandosDaIaAtiva } from '../tomada/mapa/comandos.ts'
import { provedoresDisponiveis } from '../tomada/disponibilidade.ts'
import { repoPath, repoRegistered } from '../cordel/store.ts'
import { tarefa, sessao } from './operacoes.ts'
import { ErroApi } from './contrato.ts'
import { resposta } from './idempotencia.ts'
import type { RespostaApi } from './idempotencia.ts'
import { carregarAcervo } from '../cascudo/acervo.ts'
import { agentesNexus } from '../agentes/registro.ts'
import { createHash } from 'node:crypto'
import { reconciliar } from '../observabilidade/reconciliar.ts'

export function escopoDaUrl(url: URL): Partial<Escopo> {
  const repo = url.searchParams.get('repo') || ''
  const session = url.searchParams.get('sessao') || ''
  const execucao = url.searchParams.get('execucao') || ''
  if (repo && !repoRegistered(repo)) throw new ErroApi(404, 'repo_ausente', 'projeto nao registrado')
  if (session) {
    const s = sessao(session)
    if (repo && s.repo !== repo) throw new ErroApi(404, 'escopo_ausente', 'sessao fora do projeto')
  }
  if (execucao) {
    const t = tarefa(execucao)
    if ((repo && t.campos.repo !== repo) || (session && t.campos.sessao_id !== session)) throw new ErroApi(404, 'escopo_ausente', 'execucao fora do escopo')
  }
  return { repo, sessao: session, execucao }
}
export function consultarObservabilidade(url: URL): RespostaApi | null {
  if (!url.pathname.startsWith('/v1/observabilidade/')) return null
  const filtro = escopoDaUrl(url)
  if (url.pathname === '/v1/observabilidade/snapshot') {
    reconciliar(filtro)
    const limite = Number(url.searchParams.get('limite') || '100')
    if (!Number.isInteger(limite) || limite < 1 || limite > 100) throw new ErroApi(400, 'pagina_invalida', 'limite entre 1 e 100')
    return resposta(200, snapshot(filtro, url.searchParams.get('depois') || '', limite))
  }
  if (url.pathname === '/v1/observabilidade/recursos') {
    const provedores = provedoresDisponiveis().map(p => ({ ...recurso(p.nome, 'harness'), observabilidade: 'partial', disponibilidade: p }))
    const comandos = filtro.repo ? comandosDaIaAtiva(repoPath(filtro.repo)).comandos.map(c => ({ ...recurso(c.comando, 'skill', c.origem || 'descoberto'), observabilidade: 'unobservable', estado: 'available', descricao: c.descricao })) : []
    const skills = carregarAcervo().map(s => ({ ...recurso(s.id, 'skill', s.origem), versao: createHash('sha256').update(s.instrucoes).digest('hex'), estado: 'available', pack: s.pack }))
    const agentes = Object.entries(agentesNexus()).map(([nome, a]) => ({ ...recurso(nome, 'agent', 'acervo-local'), versao: createHash('sha256').update(a.prompt).digest('hex'), estado: 'available', observabilidade: 'partial' }))
    const limite = Number(url.searchParams.get('limite') || '100')
    if (!Number.isInteger(limite) || limite < 1 || limite > 100) throw new ErroApi(400, 'pagina_invalida', 'limite entre 1 e 100')
    const depois = url.searchParams.get('depois') || ''
    const todos = [...new Map([...provedores, ...comandos, ...skills, ...agentes].map(r => [r.id, r])).values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).filter(r => !depois || r.id > depois)
    const recursos = todos.slice(0, limite)
    return resposta(200, { versao: 1, recursos, proxima: todos.length > recursos.length ? recursos.at(-1)?.id ?? null : null, nota: 'disponibilidade nao comprova carregamento nem execucao' })
  }
  throw new ErroApi(404, 'rota_ausente', 'rota nao encontrada')
}
export function streamObservabilidade(req: IncomingMessage, res: ServerResponse, url: URL, aoFechar: () => void): void {
  const filtro = escopoDaUrl(url)
  let cursor = typeof req.headers['last-event-id'] === 'string' ? req.headers['last-event-id'] : ''
  if (cursor.length > 100) throw new ErroApi(400, 'cursor_invalido', 'cursor invalido')
  const atual = snapshot(filtro)
  if (atual.degradado && !atual.cursor) throw new ErroApi(503, 'telemetria_indisponivel', atual.motivo || 'registro indisponivel')
  if (!cursor) cursor = atual.cursor
  if (eventos(cursor, filtro).reset) throw new ErroApi(409, 'cursor_expirado', 'reconstrua /v1/observabilidade/snapshot')
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' })
  res.write('retry: 1000\n\n')
  let ticks = 0
  const ler = (): void => {
    try {
      const lote = eventos(cursor, filtro)
      if (lote.reset) { res.end('event: reset\ndata: {}\n\n'); return }
      for (const e of lote.eventos) if (!res.write(`id: ${e.id}\nevent: ${e.tipo}\ndata: ${JSON.stringify(e)}\n\n`)) { res.end(); return }
      cursor = lote.cursor
      // Avanca inclusive sobre eventos de outros escopos sem revelar dados.
      if (!res.write(`id: ${cursor}\nevent: cursor\ndata: {}\n\n`)) { res.end(); return }
      if (++ticks % 60 === 0 && !res.write(': heartbeat\n\n')) res.end()
    } catch { res.end('event: reset\ndata: {}\n\n') }
  }
  const timer = setInterval(ler, 250)
  res.once('close', () => { clearInterval(timer); aoFechar() })
  ler()
}
