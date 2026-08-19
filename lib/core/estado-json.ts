import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { isoAt } from '../card'
import type { Fields } from '../card'
import { allCards } from '../runner/card-store'
import { cardsDir } from '../runner/config'
import { readClarify } from '../runner/clarify'
import { usoDeDisco } from '../runner/estado-em-disco'
import type { UsoDeDisco } from '../runner/estado-em-disco'
import { daemonPid, daemonStatus } from './daemon'
import { lerCota } from './cota'
import type { LeituraDeCota } from './cota'
import { lerSaudeDoMotor } from './saude'
import type { SaudeDoMotor } from './saude'
import { historicoDeSessoes } from './historico'
import type { Sessao } from './historico'
import { esperaHumano, isActive, phaseIndex, phaseLabel, waitsHuman } from './render/phases'
import { passosDe } from './passos'
import type { Passo } from './progresso'
import { floorProviders, formatProviders } from '../runner/cost-gap'

export const VERSAO_DO_CONTRATO = 1

export interface PerguntaAberta {
  indice: number
  total: number
  pergunta: string
  opcoes: string[]
  recomendada: string
}

export interface AcaoHumana {
  motivo: string
  comando: string
}

export interface TarefaNoPainel {
  id: string
  titulo: string
  repo: string
  status: string
  fase: string
  faseIndice: number
  ativa: boolean
  esperandoHumano: boolean
  acaoHumana: AcaoHumana | null
  passos: Passo[]
  url: string
  prUrl: string
  custoUsd: number
  custoPiso: string
  tokens: number
  criadoEm: string
  atualizadoEm: string
  pergunta: PerguntaAberta | null
}

export interface DaemonNoPainel {
  pid: number
  vivo: boolean
  estado: string
}

export interface SnapshotDoMotor {
  versao: number
  geradoEm: string
  revisao: string
  raizDoEstado: string
  daemon: DaemonNoPainel
  saude: SaudeDoMotor
  disco: UsoDeDisco
  cota: LeituraDeCota
  tarefas: TarefaNoPainel[]
  sessoes: Sessao[]
}

function texto(c: Fields, campo: keyof Fields): string {
  return String(c[campo] ?? '')
}

function numero(bruto: string): number {
  const n = parseFloat(bruto)
  return Number.isFinite(n) ? n : 0
}

function perguntaAberta(c: Fields): PerguntaAberta | null {
  if (texto(c, 'status') !== 'CLARIFY') return null
  const perguntas = readClarify(texto(c, 'id'))
  const indice = perguntas.findIndex(q => !q.answer)
  const atual = perguntas[indice]
  if (!atual) return null
  return {
    indice,
    total: perguntas.length,
    pergunta: atual.q,
    opcoes: atual.options,
    recomendada: atual.recommended || atual.options[0] || '',
  }
}

function tarefaNoPainel(c: Fields): TarefaNoPainel {
  const status = texto(c, 'status') || 'INBOX'
  const espera = esperaHumano(status)
  return {
    id: texto(c, 'id'),
    titulo: texto(c, 'title'),
    repo: texto(c, 'repo'),
    status,
    fase: phaseLabel(status),
    faseIndice: phaseIndex(status),
    ativa: isActive(status),
    esperandoHumano: waitsHuman(status),
    acaoHumana: espera ? { motivo: espera.motivo, comando: espera.comando } : null,
    passos: passosDe(c),
    url: texto(c, 'url'),
    prUrl: texto(c, 'pr_url'),
    custoUsd: numero(texto(c, 'cost_usd')),
    custoPiso: formatProviders(floorProviders(c)),
    tokens: Number(texto(c, 'tokens_total')) || 0,
    criadoEm: texto(c, 'created'),
    atualizadoEm: texto(c, 'updated'),
    pergunta: perguntaAberta(c),
  }
}

function arquivosDoEstado(): string[] {
  const raiz = cardsDir()
  if (!existsSync(raiz)) return []
  const saida: string[] = []
  for (const dir of [raiz, join(raiz, 'runs')]) {
    if (!existsSync(dir)) continue
    for (const nome of readdirSync(dir)) {
      if (nome.endsWith('.md') || nome.endsWith('.json')) saida.push(join(dir, nome))
    }
  }
  return saida
}

function maiorMtime(arquivos: string[]): number {
  let maior = 0
  for (const f of arquivos) {
    try {
      maior = Math.max(maior, Math.round(statSync(f).mtimeMs))
    } catch {
      continue
    }
  }
  return maior
}

export function revisaoDoEstado(): string {
  const arquivos = arquivosDoEstado()
  return `${arquivos.length}-${maiorMtime(arquivos)}`
}

export interface OpcoesDoSnapshot {
  repo?: string
  limiteDeSessoes?: number
  agoraMs?: number
}

function porId(a: Fields, b: Fields): number {
  return Number(texto(a, 'id')) - Number(texto(b, 'id'))
}

export function snapshotDoMotor(opts: OpcoesDoSnapshot = {}): SnapshotDoMotor {
  const agoraMs = opts.agoraMs ?? Date.now()
  const repo = opts.repo ?? ''
  const cards = allCards().filter(c => !repo || texto(c, 'repo') === repo)
  const pid = daemonPid()
  return {
    versao: VERSAO_DO_CONTRATO,
    geradoEm: isoAt(agoraMs),
    revisao: revisaoDoEstado(),
    raizDoEstado: cardsDir(),
    daemon: { pid, vivo: pid > 0, estado: daemonStatus() },
    saude: lerSaudeDoMotor(agoraMs),
    disco: usoDeDisco(),
    cota: lerCota(agoraMs),
    tarefas: [...cards].sort(porId).map(tarefaNoPainel),
    sessoes: historicoDeSessoes(opts.limiteDeSessoes ?? 20).sessoes,
  }
}
