import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { timingSafeEqual, createHash } from 'node:crypto'
import { snapshotDoMotor } from '../mirante/estado-json.ts'
import { STATUSES } from '../cordel/index.ts'
import { repoPath, repoRegistered } from '../cordel/store.ts'
import { listarSessoesHii } from '../euclides/sessoes.ts'
import { lerEventos, prepararPonte, TIPOS_DA_PONTE } from '../euclides/ponte-eventos.ts'
import { comandosDaIaAtiva } from '../tomada/mapa/comandos.ts'
import { provedoresDisponiveis } from '../tomada/disponibilidade.ts'
import { modelosDe } from '../tomada/catalogo.ts'
import { lerPlano } from '../oswaldo/orquestracao/planos.ts'
import { arquivoDeEvidencias } from '../oswaldo/orquestracao/evidencias.ts'
import type { RelatorioDeEvidencias } from '../oswaldo/orquestracao/evidencias.ts'
import { existsSync, readFileSync } from 'node:fs'
import { ACOES, ErroApi, objeto, idValido } from './contrato.ts'
import type { Json } from './contrato.ts'
import { resposta, umaVez } from './idempotencia.ts'
import type { RespostaApi } from './idempotencia.ts'
import { agir, tarefa, sessao, etagDaSessao, novaSessao, novoPedido, fecharSessao, projetos } from './operacoes.ts'
import { lerLog } from './log.ts'
import { openapi } from './openapi.ts'

const LIMITE_CORPO = 2 * 1024 * 1024
function cabecalho(req: IncomingMessage, nome: string): string {
  const valor = req.headers[nome]
  return typeof valor === 'string' ? valor : ''
}
function digest(t: string): Buffer { return createHash('sha256').update(t).digest() }

async function corpo(req: IncomingMessage): Promise<string> {
  if (!/^application\/json(?:\s*;.*)?$/i.test(cabecalho(req, 'content-type'))) throw new ErroApi(415, 'tipo_invalido', 'use application/json')
  if (Number(cabecalho(req, 'content-length')) > LIMITE_CORPO) throw new ErroApi(413, 'corpo_grande', 'limite de 2 MiB')
  const buffer = await new Promise<Buffer>((resolve, reject) => {
    let tamanho = 0
    const partes: Buffer[] = []
    const limpar = (): void => { req.off('data', dados); req.off('end', fim); req.off('aborted', abortado); req.off('error', erro) }
    const erro = (e: Error): void => { limpar(); reject(e) }
    const abortado = (): void => erro(new ErroApi(408, 'pedido_interrompido', 'envio interrompido'))
    const fim = (): void => { limpar(); resolve(Buffer.concat(partes)) }
    const dados = (p: Buffer): void => {
      tamanho += p.length
      if (tamanho > LIMITE_CORPO) {
        erro(new ErroApi(413, 'corpo_grande', 'limite de 2 MiB'))
        req.resume()
      } else partes.push(p)
    }
    req.on('data', dados); req.once('end', fim); req.once('aborted', abortado); req.once('error', erro)
  })
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer) } catch {
    throw new ErroApi(400, 'json_invalido', 'UTF-8 invalido')
  }
}

function enviar(res: ServerResponse, r: RespostaApi): void {
  res.writeHead(r.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', ...(r.etag ? { etag: r.etag } : {}) })
  res.end(r.corpo)
}

function stream(req: IncomingMessage, res: ServerResponse, aoFechar: () => void): void {
  let cursor = cabecalho(req, 'last-event-id')
  if (cursor.length > 100) throw new ErroApi(400, 'cursor_invalido', 'Last-Event-ID invalido')
  const inicial = lerEventos(cursor)
  if (inicial.reset) throw new ErroApi(409, 'cursor_expirado', 'consulte /v1/estado e reconecte com o cursor retornado')
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' })
  res.write('retry: 1000\n\n')
  if (!cursor) {
    cursor = inicial.cursor
    res.write(`id: ${cursor}\nevent: pronto\ndata: ${JSON.stringify({ cursor })}\n\n`)
  }
  let ticks = 0
  const ler = (): void => {
    try {
      const lote = lerEventos(cursor)
      if (lote.reset) {
        res.end('event: reset\ndata: {"motivo":"consulte /v1/estado"}\n\n')
        return
      }
      for (const e of lote.eventos) {
        cursor = e.id
        if (!res.write(`id: ${e.id}\nevent: ${e.tipo}\ndata: ${JSON.stringify(e)}\n\n`)) {
          // Cliente lento reconecta pelo ultimo evento recebido; fila nao cresce.
          res.end()
          return
        }
      }
      if (++ticks % 60 === 0 && !res.write(': heartbeat\n\n')) res.end()
    } catch { res.end('event: reset\ndata: {"motivo":"consulte /v1/estado"}\n\n') }
  }
  const timer = setInterval(ler, 250)
  res.once('close', () => { clearInterval(timer); aoFechar() })
  ler()
}

function consulta(url: URL): RespostaApi {
  const repo = url.searchParams.get('repo') ?? ''
  if (repo && !repoRegistered(repo)) throw new ErroApi(404, 'repo_ausente', 'projeto nao registrado')
  if (url.pathname === '/v1/capacidades') return resposta(200, {
    protocolo: 'hii-http', versao: 1, transporte: 'http-json+sse', statuses: STATUSES,
    acoes: ACOES, eventos: TIPOS_DA_PONTE, modos: ['gateway', 'orquestrador'],
    specs: 'conteudo UTF-8, sem leitura de caminhos remotos', idempotencia: true,
    retencaoEventos: 1000, autenticacao: 'bearer', multiusuario: false,
  })
  if (url.pathname === '/v1/openapi.json') return resposta(200, openapi)
  if (url.pathname === '/v1/projetos') return resposta(200, { projetos: projetos() })
  if (url.pathname === '/v1/provedores') return resposta(200, { provedores: provedoresDisponiveis().map(p => ({ ...p, modelos: modelosDe(p.nome) })) })
  if (url.pathname === '/v1/estado') {
    // Cursor ANTES do snapshot: duplicatas sao deduplicaveis; lacunas nao.
    const cursor = lerEventos().cursor
    return resposta(200, { ...snapshotDoMotor({ repo }), cursor })
  }
  if (url.pathname === '/v1/sessoes') return resposta(200, { sessoes: listarSessoesHii(repo) })
  if (url.pathname === '/v1/recursos') {
    if (!repo) throw new ErroApi(400, 'repo_obrigatorio', 'informe repo')
    const catalogo = comandosDaIaAtiva(repoPath(repo))
    return resposta(200, { provedor: catalogo.provedor, comandos: catalogo.comandos.map(c => ({ comando: c.comando, descricao: c.descricao, origem: c.origem })) })
  }
  const m = url.pathname.match(/^\/v1\/(sessoes|tarefas)\/(\d{3,12})(\/log|\/plano)?$/)
  if (!m || !idValido(m[2] ?? '')) throw new ErroApi(404, 'rota_ausente', 'rota nao encontrada')
  const id = m[2] ?? ''
  if (m[1] === 'sessoes' && !m[3]) return resposta(200, sessao(id), etagDaSessao(id))
  if (m[1] !== 'tarefas') throw new ErroApi(404, 'rota_ausente', 'rota nao encontrada')
  const t = tarefa(id)
  if (m[3] === '/log') return resposta(200, lerLog(id, Number(url.searchParams.get('offset') ?? '0')))
  if (m[3] === '/plano') {
    const plano = lerPlano(t.campos.repo ?? '', id)
    const arquivo = plano ? arquivoDeEvidencias(id, plano.revisao) : ''
    const evidencias = arquivo && existsSync(arquivo) ? JSON.parse(readFileSync(arquivo, 'utf8')) as RelatorioDeEvidencias : null
    return resposta(200, { plano, evidencias, atualidadeVerificada: false })
  }
  return resposta(200, t, t.etag)
}

async function mutacao(req: IncomingMessage, url: URL): Promise<RespostaApi> {
  const bruto = await corpo(req)
  let b: Json
  try { b = JSON.parse(bruto) as Json } catch { throw new ErroApi(400, 'json_invalido', 'JSON invalido') }
  const entrada = objeto(b)
  const m = url.pathname.match(/^\/v1\/(sessoes|tarefas)\/(\d{3,12})\/(pedidos|fechar|acoes)$/)
  const rotaValida = url.pathname === '/v1/sessoes' || (m && (
    (m[1] === 'sessoes' && ['pedidos', 'fechar'].includes(m[3] ?? '')) || (m[1] === 'tarefas' && m[3] === 'acoes')))
  if (!rotaValida || url.search) throw new ErroApi(404, 'rota_ausente', 'rota nao encontrada')
  const esperado = cabecalho(req, 'if-match')
  return umaVez(cabecalho(req, 'idempotency-key'), JSON.stringify([url.pathname, esperado, entrada]), () => {
    if (url.pathname === '/v1/sessoes') return novaSessao(entrada)
    const id = m?.[2] ?? ''
    if (m?.[3] === 'pedidos') return novoPedido(id, entrada)
    if (m?.[3] === 'fechar') return fecharSessao(id, esperado, entrada)
    return agir(id, entrada, esperado)
  })
}

export function criarServidorApi(token: string): Server {
  if (token.length < 32 || /\s/.test(token)) throw new Error('HII_API_TOKEN deve ter ao menos 32 caracteres sem espacos')
  prepararPonte()
  let streams = 0
  const servidor = createServer((req, res) => {
    void (async () => {
      if (!timingSafeEqual(digest(cabecalho(req, 'authorization')), digest(`Bearer ${token}`))) throw new ErroApi(401, 'nao_autorizado', 'Bearer token obrigatorio')
      if (req.headers.origin !== undefined) throw new ErroApi(403, 'origem_recusada', 'use o backend do Hicode; token nao pertence ao navegador')
      const url = new URL(req.url ?? '/', 'http://hii.local')
      if (req.method === 'GET' && url.pathname === '/v1/eventos') {
        if (streams >= 16) throw new ErroApi(429, 'limite_streams', 'limite de streams atingido')
        stream(req, res, () => { streams-- })
        streams++
      } else if (req.method === 'GET') enviar(res, consulta(url))
      else if (req.method === 'POST') enviar(res, await mutacao(req, url))
      else throw new ErroApi(405, 'metodo_invalido', 'use GET ou POST')
    })().catch((e: Error) => {
      if (res.headersSent) { res.end(); return }
      const erro = e instanceof ErroApi ? e : new ErroApi(500, 'erro_interno', 'falha interna; reconcilie o estado antes de repetir uma mutacao')
      enviar(res, resposta(erro.status, { erro: { codigo: erro.codigo, mensagem: erro.message } }))
    })
  })
  servidor.requestTimeout = 15000
  servidor.headersTimeout = 10000
  servidor.maxHeadersCount = 40
  return servidor
}

export async function servirApi(): Promise<void> {
  const porta = Number(process.env.HII_API_PORT || 8787)
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) throw new Error('HII_API_PORT invalida')
  const host = process.env.HII_API_HOST || '127.0.0.1'
  const servidor = criarServidorApi(process.env.HII_API_TOKEN || '')
  await new Promise<void>((resolve, reject) => {
    servidor.once('error', reject)
    servidor.listen(porta, host, resolve)
  })
  process.stderr.write(`[hii] API v1 em http://${host}:${porta}; daemon de execucao permanece separado\n`)
  const fechar = (): void => { servidor.close(); servidor.closeAllConnections() }
  process.once('SIGTERM', fechar)
  process.once('SIGINT', fechar)
  await new Promise<void>(resolve => servidor.once('close', resolve))
  process.off('SIGTERM', fechar)
  process.off('SIGINT', fechar)
}
