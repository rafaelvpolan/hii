export const STATUSES = [
  'INBOX', 'READY', 'CLARIFY', 'SPECCED', 'PLAN_APPROVED', 'EXECUTING', 'PAUSED', 'WAITING', 'EXECUTED',
  'URL', 'CORRECTING', 'URL_OK', 'REFINED', 'TESTS_GREEN', 'SEC_CLEARED', 'REVIEWED',
  'CLEANED', 'PR_OPEN', 'MERGED', 'DEPLOYED', 'HALTED',
] as const

export type Status = (typeof STATUSES)[number]

export type Risk = 'low' | 'high'

export type Fields = Record<string, string>

export interface Parsed {
  fm: Fields
  order: string[]
  body: string
}

export interface Card extends Parsed {
  file: string
}

export interface Repo {
  name: string
  url: string
  branch: string
  runCmd: string
  added: string
}

export interface Usage {
  tokens_in: number
  tokens_out: number
  tokens_cache_create: number
  tokens_cache_read: number
}

export type PapelDeChamada =
  | 'implement' | 'verify' | 'gate' | 'step'
  | 'clarify' | 'conversa' | 'classificacao' | 'ideacao' | 'avaliacao'
  | 'desconhecido'

export interface ChamadaDeIa {
  ts: string
  papel: PapelDeChamada
  provedor: string
  modelo: string
  custoUsd: number
  custoMedido: boolean
  tokens: number
  tokensEntrada: number
  tokensSaida: number
  tokensCache: number
  duracaoS: number
  ok: boolean
  classeDeFalha?: FailureClass | ''
}

export interface IaDaSessao {
  papel: PapelDeChamada
  rotulo: string
  provedor: string
  modelo: string
  custoUsd: number
  custoMedido: boolean
  tokens: number
  tokensEntrada: number
  tokensSaida: number
  tokensCache: number
  duracaoS: number
  chamadas: number
  falhas: number
  classeDeFalha?: FailureClass | ''
}

export interface TrocaDeProvedor {
  papel: PapelDeChamada
  rotulo: string
  de: string
  para: string
}

export interface StepMetric {
  time: number
  cost: number
  tokens: number
  costMeasured?: boolean
}

export type StepMap = Record<string, StepMetric>

export interface Run {
  id: string
  ts: string
  ok: boolean
  cost_usd: string
  cost_measured: boolean
  duration_s: number
  tokens_in: number
  tokens_out: number
  tokens_cache_create: number
  tokens_cache_read: number
  tokens_total: number
  steps: StepMap | null
  provider: string
  model: string
  session?: string
  kind?: 'execucao' | 'conversa'
  ias?: IaDaSessao[]
  trocas?: TrocaDeProvedor[]
  failure_class: FailureClass | ''
  failure_reason: string
}

export type FailureClass = 'transient' | 'quota' | 'terminal'

export interface VerifyResult {
  ok: boolean
  reason: string
  cost: number
  tokens: number
  conclusive?: boolean
}

export interface ImplementResult {
  ok: boolean
  resultText?: string
  fullText?: string
  reason?: string
  cost: string
  costMeasured?: boolean
  usage?: Usage
  timedOut?: boolean
  failureClass?: FailureClass
  failureReason?: string
  provider?: string
  model?: string
}

export interface ClarifyQuestion {
  q: string
  options: string[]
  recommended: string
  answer?: string
}

export type JobKind = 'execute' | 'finish' | 'correct' | 'spec'

export interface Job {
  kind: JobKind
  id: string
}
