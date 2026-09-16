import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { cardsDir } from '../cordel/alicerce/config.ts'
import { readCard } from '../cordel/store.ts'
import { withFileLock, writeFileAtomic } from '../oswaldo/mutirao/trava-arquivo.ts'
import { idValido } from '../oswaldo/orquestracao/contrato.ts'
import type { ModoDoMotor } from '../oswaldo/orquestracao/config.ts'
import { publicarEvento } from './ponte-eventos.ts'
import { conferirRevisao } from '../cordel/revisao.ts'

export interface MensagemDaSessao {
  id: string
  autor: 'humano' | 'ia'
  texto: string
  execucao: string
  provedor: string
  modelo: string
  instante: string
}

export interface SubsessaoDeIa {
  id: string
  execucao: string
  provedor: string
  modelo: string
  papel: string
  nativa: string | null
  inicio: string
  fim: string
  estado: 'executando' | 'concluida' | 'falhou' | 'interrompida'
}

export interface SessaoHii {
  versao: 1
  id: string
  repo: string
  titulo: string
  revisao: number
  estado: 'aberta' | 'fechada'
  consultas?: { id: string; criadaEm: string }[]
  mensagens: MensagemDaSessao[]
  execucoes: { id: string; modo: ModoDoMotor; criadaEm: string }[]
  subsessoes: SubsessaoDeIa[]
}

function arquivo(id: string): string {
  if (!idValido(id)) throw new Error('ID de sessao invalido')
  return join(cardsDir(), 'sessoes', `${id}.json`)
}

export function lerSessaoHii(id: string): SessaoHii | null {
  const caminho = arquivo(id)
  if (!existsSync(caminho)) return null
  const s = JSON.parse(readFileSync(caminho, 'utf8')) as SessaoHii
  if (s?.versao !== 1 || s.id !== id || !Array.isArray(s.mensagens) || !Array.isArray(s.execucoes) || !Array.isArray(s.subsessoes)) throw new Error('contrato de sessao invalido')
  return s
}

export function criarSessaoHii(id: string, repo: string, titulo: string): SessaoHii {
  mkdirSync(join(cardsDir(), 'sessoes'), { recursive: true })
  const caminho = arquivo(id)
  return withFileLock(caminho, () => {
    const existente = lerSessaoHii(id)
    if (existente) {
      if (existente.repo !== repo) throw new Error('sessao pertence a outro projeto')
      return existente
    }
    const s: SessaoHii = { versao: 1, id, repo, titulo, revisao: 1, estado: 'aberta', mensagens: [], execucoes: [], subsessoes: [] }
    writeFileAtomic(caminho, JSON.stringify(s, null, 2) + '\n')
    publicarEvento('sessao_atualizada', '', id, { estado: s.estado, revisao: String(s.revisao) })
    return s
  })
}

function atualizar(id: string, mudar: (sessao: SessaoHii) => void | boolean): SessaoHii {
  const caminho = arquivo(id)
  return withFileLock(caminho, () => {
    const s = lerSessaoHii(id)
    if (!s) throw new Error(`sessao ${id} nao encontrada`)
    if (mudar(s) === false) return s
    s.revisao++
    writeFileAtomic(caminho, JSON.stringify(s, null, 2) + '\n')
    publicarEvento('sessao_atualizada', '', id, { estado: s.estado, revisao: String(s.revisao) })
    return s
  })
}

export function registrarMensagem(id: string, mensagem: Omit<MensagemDaSessao, 'id' | 'instante'>, chave: string = randomUUID()): void {
  atualizar(id, s => {
    const anterior = s.mensagens.find(m => m.id === chave)
    if (anterior) {
      if (['autor', 'texto', 'execucao', 'provedor', 'modelo'].some(c => anterior[c as keyof MensagemDaSessao] !== mensagem[c as keyof typeof mensagem])) throw new Error('chave de mensagem reutilizada com outro conteudo')
      return false
    }
    if (s.estado !== 'aberta') throw new Error('sessao fechada')
    s.mensagens.push({ ...mensagem, id: chave, instante: new Date().toISOString() })
  })
}

export function vincularExecucao(id: string, execucao: string, modo: ModoDoMotor): void {
  atualizar(id, s => {
    if (s.estado !== 'aberta') throw new Error('sessao fechada; abra outra com /new')
    if (!s.execucoes.some(e => e.id === execucao)) s.execucoes.push({ id: execucao, modo, criadaEm: new Date().toISOString() })
  })
}

export function iniciarSubsessao(id: string, execucao: string, provedor: string, modelo: string, papel: string): string {
  const chave = randomUUID()
  atualizar(id, s => {
    if (s.estado !== 'aberta') throw new Error('sessao fechada')
    s.subsessoes.push({ id: chave, execucao, provedor, modelo, papel, nativa: null, inicio: new Date().toISOString(), fim: '', estado: 'executando' })
  })
  return chave
}

export function concluirSubsessao(id: string, chave: string, ok: boolean, nativa: string | null = null): void {
  atualizar(id, s => {
    const sub = s.subsessoes.find(e => e.id === chave)
    if (!sub) throw new Error('subsessao nao encontrada')
    sub.estado = ok ? 'concluida' : 'falhou'
    sub.fim = new Date().toISOString()
    sub.nativa = nativa
  })
}

export function finalizarChamada(id: string, chave: string, resultado: { ok: boolean; texto: string; interrompida?: boolean }): void {
  atualizar(id, s => {
    const sub = s.subsessoes.find(e => e.id === chave)
    if (!sub) throw new Error('subsessao nao encontrada')
    if (s.mensagens.some(m => m.id === chave)) return false
    sub.estado = sub.estado === 'interrompida' || resultado.interrompida ? 'interrompida' : resultado.ok ? 'concluida' : 'falhou'
    sub.fim = new Date().toISOString()
    s.mensagens.push({ id: chave, autor: 'ia', texto: resultado.texto, execucao: sub.execucao,
      provedor: sub.provedor, modelo: sub.modelo, instante: sub.fim })
  })
}

export function vincularConsulta(id: string, consulta: string, pergunta: string): void {
  atualizar(id, s => {
    if (s.estado !== 'aberta') throw new Error('sessao fechada')
    s.consultas ??= []
    if (s.consultas.some(c => c.id === consulta)) return false
    const instante = new Date().toISOString()
    s.consultas.push({ id: consulta, criadaEm: instante })
    s.mensagens.push({ id: `consulta-${consulta}`, autor: 'humano', texto: pergunta,
      execucao: consulta, provedor: '', modelo: '', instante })
  })
}

export function interromperSubsessoes(id: string, execucao: string): void {
  atualizar(id, s => {
    for (const sub of s.subsessoes) {
      if (sub.execucao !== execucao || sub.estado !== 'executando') continue
      sub.estado = 'interrompida'
      sub.fim = new Date().toISOString()
    }
  })
}

export function fecharSessaoHii(id: string): SessaoHii {
  return atualizar(id, s => {
    conferirRevisao(id, s)
    if ((s.consultas ?? []).some(c => {
      const caminho = join(cardsDir(), 'consultas', `${c.id}.json`)
      if (!existsSync(caminho)) return true
      const registro = JSON.parse(readFileSync(caminho, 'utf8')) as { estado: string }
      return !['succeeded', 'failed'].includes(registro.estado)
    })) throw new Error('sessao possui consulta pendente ou resultado incerto')
    if (s.subsessoes.some(e => e.estado === 'executando')) throw new Error('sessao possui execucao em andamento')
    if (s.execucoes.some(e => {
      const status = readCard(e.id)?.fm.status
      return status && !['COMPLETED', 'PR_OPEN', 'MERGED', 'DEPLOYED', 'HALTED'].includes(status)
    })) throw new Error('sessao possui execucao pendente; conclua ou pare antes de fechar')
    s.estado = 'fechada'
  })
}

export function contextoDaSessao(id: string, limite = 24000): string {
  const s = lerSessaoHii(id)
  if (!s) return ''
  const linhas = s.mensagens.map(m => `[${m.autor}${m.provedor ? `/${m.provedor}/${m.modelo}` : ''}; execucao ${m.execucao || 'consulta'}] ${m.texto}`)
  let tamanho = 0
  let parciais = 0
  const recentes: string[] = []
  for (const linha of [...linhas].reverse()) {
    const restante = Math.max(0, limite - tamanho)
    if (!restante) break
    const trecho = linha.length > restante ? linha.slice(0, restante) : linha
    recentes.unshift(trecho)
    tamanho += trecho.length
    if (trecho.length < linha.length) { parciais++; break }
  }
  const omitidas = linhas.length - recentes.length + parciais
  return [`SESSAO HII #${id} (${s.repo}). Preserve decisoes e autoria; o provedor pode ter mudado.`,
    ...(omitidas ? [`${omitidas} mensagens anteriores preservadas no historico ${arquivo(id)}; consulte quando necessario.`] : []), ...recentes].join('\n')
}

export function listarSessoesHii(repo = ''): SessaoHii[] {
  const dir = join(cardsDir(), 'sessoes')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(f => f.endsWith('.json')).map(f => lerSessaoHii(f.slice(0, -5)))
    .filter((s): s is SessaoHii => s !== null && (!repo || s.repo === repo))
}
