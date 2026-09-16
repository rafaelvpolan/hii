import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID, createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { cardsDir } from '../cordel/alicerce/config.ts'
import { withFileLock, writeFileAtomic } from '../oswaldo/mutirao/trava-arquivo.ts'
import { redigirDiagnostico } from '../tomada/diagnostico.ts'
import { inicioNoKernel } from '../tomada/harness-em-voo.ts'
import { corresponde, terminal } from './contrato.ts'
import type { Atividade, Canal, Escopo, Estado, Evento, Recurso, Snapshot } from './contrato.ts'
import type { Json } from '../api/contrato.ts'

const MAX_EVENTOS = 2048
const MAX_ATIVIDADES = 512
const DIAS = 7
const contexto = new AsyncLocalStorage<string>()
const inicioProcesso = inicioNoKernel(process.pid)
const falhas = new Map<string, string>()
interface Diario { geracao: string; sequencia: number; atividades: Atividade[]; eventos: Evento[] }
// Reutiliza somente a ultima escrita deste processo, sob o lock e apos verificar
// a identidade do arquivo. Leitores continuam lendo a projecao atomica do disco.
let ultimaEscrita: { arquivo: string; identidade: string; diario: Diario } | null = null
function identidade(arquivo: string): string {
  const s = statSync(arquivo, { bigint: true })
  return `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`
}
const caminho = (): string => join(cardsDir(), 'observabilidade', 'estado.json')
const agora = (): string => new Date().toISOString()
function ler(): Diario {
  if (!existsSync(caminho())) return { geracao: randomUUID(), sequencia: 0, atividades: [], eventos: [] }
  const d = JSON.parse(readFileSync(caminho(), 'utf8')) as Diario
  if (!d.geracao || !Number.isSafeInteger(d.sequencia) || !Array.isArray(d.atividades) || !Array.isArray(d.eventos)) throw new Error('registro invalido')
  return d
}
/** Redacao por VALOR, nao sobre JSON serializado (preserva o contrato). */
export function textoPublico(texto: string): string {
  let seguro = texto
  for (const [chave, valor] of Object.entries(process.env)) {
    if (/token|secret|password|credential|api.?key/i.test(chave) && valor && valor.length >= 4) seguro = seguro.split(valor).join('[REDACTED]')
  }
  return redigirDiagnostico(seguro)
}
export function jsonPublico(valor: Json): Json {
  if (typeof valor === 'string') return textoPublico(valor)
  if (Array.isArray(valor)) return valor.map(jsonPublico)
  if (valor && typeof valor === 'object') return Object.fromEntries(Object.entries(valor).map(([k, v]) =>
    [k, /^(?:(?:access|refresh|id)[_-]?)?token$|password|secret|credential|api[_-]?key|authorization/i.test(k) && typeof v === 'string' ? '[REDACTED]' : jsonPublico(v)]))
  return valor
}
function gravar(mudar: (d: Diario) => Atividade | undefined, tipo: Evento['tipo'] = 'activity'): void {
  if (process.env.HII_OBSERVABILIDADE === '0') return
  try {
    mkdirSync(join(cardsDir(), 'observabilidade'), { recursive: true })
    withFileLock(caminho(), () => {
      const arquivo = caminho()
      const anterior = ultimaEscrita
      ultimaEscrita = null
      const d = anterior?.arquivo === arquivo && existsSync(arquivo) && anterior.identidade === identidade(arquivo) ? anterior.diario : ler()
      const a = mudar(d)
      if (!a) return
      d.sequencia++
      // Evento e projecao entram na mesma substituicao atomica, antes do SSE.
      d.eventos.push({ id: `${d.geracao}:${d.sequencia}`, versao: 1, tipo, atividade: { ...structuredClone(a), saida: tipo === 'output' ? a.saida.slice(-1) : [] } })
      d.eventos = d.eventos.slice(-MAX_EVENTOS)
      const corte = Date.now() - DIAS * 86400000
      d.atividades = d.atividades.filter(x => !x.fim || Date.parse(x.fim) >= corte).slice(-MAX_ATIVIDADES)
      writeFileAtomic(caminho(), JSON.stringify(d))
      ultimaEscrita = { arquivo, identidade: identidade(arquivo), diario: d }
    })
  } catch {
    // Nunca propagar para um efeito, fallback ou contabilizacao de custo.
    falhas.set(caminho(), 'registro incompleto; reconcilie com o estado da execucao')
  }
}
export function recurso(nome: string, tipo: Recurso['tipo'], origem = 'hii'): Recurso {
  return { id: `${origem}:${tipo}:${nome}`, namespace: origem, nome, tipo, origem, versao: null, capacidades: [], observabilidade: 'instrumented' }
}
export function iniciar(escopo: Escopo, r: Recurso, detalhes: Atividade['detalhes'] = {}, pai: string | null = contexto.getStore() ?? null): string {
  const id = randomUUID()
  const instante = agora()
  const desconhecida = { valor: null, fonte: 'nao_reportado', instante, qualidade: 'unknown' as const }
  gravar(d => {
    const a: Atividade = { ...escopo, id, pai, recurso: r, revisao: 1, estado: r.tipo === 'skill' ? 'succeeded' : 'running', inicio: instante, atualizado: instante, heartbeat: null, fim: r.tipo === 'skill' ? instante : null,
      etapa: r.nome, tentativa: id, subsessao: null, microtask: null, planoRevisao: null, detalhes: {},
      metricas: { custoUsd: desconhecida, tokens: desconhecida, contextoTokens: desconhecida, quotaPercentual: desconhecida }, saida: [], ultimaSequencia: 0, truncado: false, dono: { pid: process.pid, inicio: inicioProcesso } }
    for (const [k, v] of Object.entries(detalhes)) a.detalhes[k] = typeof v === 'string' ? textoPublico(v).slice(0, 2048) : v
    d.atividades.push(a)
    return a
  })
  return id
}
export function atualizar(id: string, mudar: (a: Atividade) => void, tipo: Evento['tipo'] = 'activity'): void {
  gravar(d => {
    const a = d.atividades.find(x => x.id === id)
    if (!a || terminal(a.estado)) return undefined
    mudar(a)
    for (const [k, v] of Object.entries(a.detalhes)) if (typeof v === 'string') a.detalhes[k] = textoPublico(v).slice(0, 2048)
    a.etapa = textoPublico(a.etapa)
    a.revisao++
    a.atualizado = agora()
    if (terminal(a.estado)) a.fim = a.atualizado
    return a
  }, tipo)
}
export function terminar(id: string, estado: Estado, motivo = ''): void {
  atualizar(id, a => { a.estado = estado; if (motivo) a.detalhes.motivo = motivo })
}
export function saida(id: string, canal: Canal, texto: string): void {
  if (!texto) return
  atualizar(id, a => {
    a.ultimaSequencia++
    a.saida.push({ sequencia: a.ultimaSequencia, canal, texto: textoPublico(texto).slice(-8192), instante: agora() })
    while (a.saida.reduce((n, s) => n + s.texto.length, 0) > 16384 || a.saida.length > 64) { a.saida.shift(); a.truncado = true }
    if (texto.length > 8192) a.truncado = true
  }, 'output')
}
export function dentro<T>(id: string, executar: () => Promise<T>): Promise<T> { return contexto.run(id, executar) }
export function atividadeAtual(): string { return contexto.getStore() ?? '' }
export function heartbeat(id: string): void {
  gravar(d => {
    const a = d.atividades.find(x => x.id === id)
    if (!a || terminal(a.estado)) return undefined
    a.heartbeat = agora(); a.revisao++
    return a
  })
}
export function escopoAtual(): Escopo | null {
  try { const a = ler().atividades.find(x => x.id === contexto.getStore()); return a ? { repo: a.repo, sessao: a.sessao, execucao: a.execucao } : null } catch { return null }
}
export function snapshot(filtro: Partial<Escopo> = {}, depois = '', limite = 100): Snapshot {
  const retencao = { eventos: MAX_EVENTOS, atividades: MAX_ATIVIDADES, dias: DIAS }
  try {
    // Uma leitura atomica fornece estado e cursor da MESMA revisao.
    if (!existsSync(caminho())) {
      mkdirSync(join(cardsDir(), 'observabilidade'), { recursive: true })
      withFileLock(caminho(), () => { if (!existsSync(caminho())) writeFileAtomic(caminho(), JSON.stringify(ler())) })
    }
    const d = ler()
    const lista = d.atividades.filter(a => corresponde(a, filtro)).sort((a, b) => a.id.localeCompare(b.id)).filter(a => !depois || a.id > depois)
    const atividades = lista.slice(0, Math.max(1, Math.min(100, limite)))
    // Ausencia de heartbeat nao prova falha. Exibe unknown sem inventar terminal.
    for (const a of atividades) if (!terminal(a.estado) && a.detalhes.estadoAutoritativo !== true) {
      try {
        process.kill(a.dono.pid, 0)
        if (a.dono.inicio && inicioNoKernel(a.dono.pid) !== a.dono.inicio) throw new Error('PID reutilizado')
      } catch { a.estado = 'unknown'; a.detalhes.reconciliacao = 'processo ausente; consulte estado autoritativo da tarefa' }
    }
    const motivo = falhas.get(caminho()) ?? (process.env.HII_OBSERVABILIDADE === '0' ? 'telemetria desativada' : null)
    return { versao: 1, cursor: `${d.geracao}:${d.sequencia}`, atividades, degradado: motivo !== null, motivo, proxima: lista.length > atividades.length ? atividades.at(-1)?.id ?? null : null, retencao }
  } catch {
    return { versao: 1, cursor: '', atividades: [], degradado: true, motivo: 'registro indisponivel; consulte estado autoritativo', proxima: null, retencao }
  }
}
export function eventos(desde: string, filtro: Partial<Escopo> = {}): { cursor: string; reset: boolean; eventos: Evento[] } {
  const d = ler()
  const cursor = `${d.geracao}:${d.sequencia}`
  const [geracao, valor] = desde.split(':')
  const n = Number(valor)
  if (geracao !== d.geracao || !Number.isSafeInteger(n) || n < d.sequencia - d.eventos.length || n > d.sequencia) return { cursor, reset: true, eventos: [] }
  return { cursor, reset: false, eventos: d.eventos.filter(e => Number(e.id.split(':')[1]) > n && corresponde(e.atividade, filtro)) }
}

export function paiDaExecucao(execucao: string): string | null {
  return snapshot({ execucao }).atividades.filter(a => a.detalhes.estadoAutoritativo === true && !a.fim).at(-1)?.id ?? null
}

/** Espelho das transicoes publicadas pelo store; nao toma decisoes. */
export function observarEstado(execucao: string, fm: Record<string, string>): void {
  if (fm.tipo === 'session' || process.env.HII_OBSERVABILIDADE === '0') return
  try {
    const status = fm.status ?? 'INBOX'
    const estados: Record<string, Estado> = { INBOX: 'queued', READY: 'queued', WAITING: 'waiting_retry', PAUSED: 'blocked', HALTED: 'failed', CLARIFY: 'waiting_human', CONFIRM: 'waiting_human', URL: 'waiting_human', COMPLETED: 'succeeded', PR_OPEN: 'succeeded', MERGED: 'succeeded', DEPLOYED: 'succeeded', REJECTED: 'cancelled' }
    const estado = status === 'HALTED' && fm.halt_class === 'humano' ? 'cancelled' : estados[status] ?? 'running'
    const fonteRevisao = createHash('sha256').update(JSON.stringify(fm)).digest('hex')
    const anteriores = snapshot({ execucao }).atividades.filter(a => a.detalhes.estadoAutoritativo === true).sort((a, b) => a.inicio.localeCompare(b.inicio))
    const anterior = anteriores.at(-1)
    if (anterior?.detalhes.fonteRevisao === fonteRevisao) return
    if (anterior?.fim && terminal(estado) && anterior.estado === estado) return
    const id = anterior && !anterior.fim ? anterior.id : iniciar({ repo: fm.repo ?? '', sessao: fm.sessao_id ?? '', execucao }, recurso('execucao', 'orchestrator'), { estadoAutoritativo: true, tentativaAnterior: anterior?.id ?? null }, null)
    atualizar(id, a => {
      a.detalhes.fonteRevisao = fonteRevisao
      a.estado = estado; a.etapa = status
      a.microtask = fm.microtask_atual || null
      a.planoRevisao = fm.plano_revisao ? Number(fm.plano_revisao) : null
      for (const k of ['motor_modo', 'wait_reason', 'wait_class', 'wait_attempts', 'wait_until', 'resume_status', 'halt_reason', 'pr_url', 'crivo_modo']) a.detalhes[k] = fm[k] || null
      a.detalhes.progresso = 'transicao persistida do motor; heartbeat nao implica progresso'
    })
  } catch { falhas.set(caminho(), 'transicao nao observada; reconcilie a tarefa') }
}
