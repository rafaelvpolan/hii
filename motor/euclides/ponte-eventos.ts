import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { cardsDir } from '../cordel/alicerce/config.ts'
import { withFileLock, writeFileAtomic } from '../oswaldo/mutirao/trava-arquivo.ts'
import { observarEstado } from '../observabilidade/registro.ts'

export const TIPOS_DA_PONTE = ['tarefa_atualizada', 'fim', 'pausa', 'ia_falhou', 'ia_trocada', 'sessao_atualizada'] as const
export interface EventoDaPonte {
  id: string
  versao: 1
  tipo: (typeof TIPOS_DA_PONTE)[number]
  instante: string
  tarefa: string
  sessao: string
  dados: Record<string, string>
}
interface Diario { geracao: string; sequencia: number; eventos: EventoDaPonte[] }
const LIMITE = 1000

function caminho(): string { return join(cardsDir(), 'ponte', 'eventos.json') }

function ler(): Diario {
  if (!existsSync(caminho())) return { geracao: '', sequencia: 0, eventos: [] }
  const d = JSON.parse(readFileSync(caminho(), 'utf8')) as Diario
  if (!d.geracao || !Number.isSafeInteger(d.sequencia) || !Array.isArray(d.eventos)) throw new Error('diario da ponte invalido')
  return d
}

export function prepararPonte(): void {
  mkdirSync(join(cardsDir(), 'ponte'), { recursive: true })
  withFileLock(caminho(), () => {
    if (!existsSync(caminho())) writeFileAtomic(caminho(), JSON.stringify({ geracao: randomUUID(), sequencia: 0, eventos: [] }))
  })
}

export function publicarEvento(tipo: EventoDaPonte['tipo'], tarefa: string, sessao: string, dados: Record<string, string>): void {
  // Estado e autoridade; uma falha no transporte nao pode repetir trabalho pago.
  try {
    mkdirSync(join(cardsDir(), 'ponte'), { recursive: true })
    withFileLock(caminho(), () => {
      const d = ler()
      if (!d.geracao) d.geracao = randomUUID()
      d.sequencia++
      d.eventos.push({ id: `${d.geracao}:${d.sequencia}`, versao: 1, tipo, instante: new Date().toISOString(), tarefa, sessao, dados })
      d.eventos = d.eventos.slice(-LIMITE)
      writeFileAtomic(caminho(), JSON.stringify(d))
    })
  } catch {
    process.stderr.write('[hii] falha ao publicar evento da ponte; consulte o snapshot do motor\n')
  }
}

export function lerEventos(desde = ''): { cursor: string; reset: boolean; eventos: EventoDaPonte[] } {
  if (!existsSync(caminho())) prepararPonte()
  const d = ler()
  const cursor = d.geracao ? `${d.geracao}:${d.sequencia}` : ''
  if (!desde) return { cursor, reset: false, eventos: [] }
  const [geracao, n] = desde.split(':')
  const sequencia = Number(n)
  const primeiro = d.sequencia - d.eventos.length + 1
  if (geracao !== d.geracao || !Number.isSafeInteger(sequencia) || sequencia < primeiro - 1 || sequencia > d.sequencia) {
    return { cursor, reset: true, eventos: [] }
  }
  return { cursor, reset: false, eventos: d.eventos.filter(e => Number(e.id.split(':')[1]) > sequencia) }
}

export function publicarEstado(tarefa: string, campos: Record<string, string>): void {
  observarEstado(tarefa, campos)
  const status = campos.status ?? ''
  const sessao = campos.tipo === 'session' ? tarefa : campos.sessao_id ?? ''
  publicarEvento('tarefa_atualizada', tarefa, sessao, { status })
  if (['COMPLETED', 'PR_OPEN', 'MERGED', 'DEPLOYED', 'HALTED'].includes(status)) {
    publicarEvento('fim', tarefa, sessao, { status, resultado: status === 'HALTED' ? 'falha' : 'sucesso' })
  } else if (['CONFIRM', 'CLARIFY', 'PAUSED', 'URL'].includes(status)) {
    publicarEvento('pausa', tarefa, sessao, { status })
  }
}
