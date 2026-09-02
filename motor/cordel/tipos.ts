export const STATUSES = [
  'INBOX', 'READY', 'CLARIFY', 'SPECCED', 'PLAN_APPROVED', 'EXECUTING', 'PAUSED', 'WAITING', 'EXECUTED',
  'URL', 'CORRECTING', 'URL_OK', 'REFINED', 'TESTS_GREEN', 'SEC_CLEARED', 'REVIEWED',
  'CLEANED', 'CONFIRM', 'PR_OPEN', 'MERGED', 'DEPLOYED', 'HALTED',
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

export const CLASSES_DE_FALHA = ['transient', 'quota', 'terminal'] as const

export type FailureClass = (typeof CLASSES_DE_FALHA)[number]

export function ehClasseDeFalha(valor: string | undefined): valor is FailureClass {
  return !!valor && (CLASSES_DE_FALHA as readonly string[]).includes(valor)
}

// Sub-classe de `transient`, e existe por causa do BACKOFF. `FailureClass` nao serve
// para escalar espera: `quota` e `terminal` vao direto a HALT
// (motor/ciclo/reprise/politica.ts), entao tudo o que chega a WAITING e `transient` —
// escalar por um valor constante nao escala nada. O que distingue e o que a falha
// CUSTOU: card 002 entrou em WAITING as 13:20:03 por timeout de 900 s do CLI e foi
// acordado as 13:20:33, trinta segundos depois. Um timeout de quinze minutos
// retentado em trinta segundos e a parte cara.
// `halt_class` precisa de vocabulario MAIS LARGO que FailureClass, e a falta disso e
// a razao pela qual 29 das 31 escritas de `status: 'HALTED'` no motor nao traziam
// classe nenhuma: card para por motivo que nao e falha de chamada de IA. O card 002
// e a prova — frontmatter sem `halt_class`, sem `halt_at`, sem `halt_reason`, ultimo
// log em texto livre, e `porHalts` (euclides/radar/saude.ts) descartando o card
// porque so olha `quota` e `transient`. Motor parado respondendo "ocioso".
//
//   transient | quota | terminal  falha de chamada de IA, ja classificada por
//                                 ciclo/reprise/classe-de-falha.ts
//   orcamento                     o portao de custo barrou; gastar mais e decisao sua
//   escopo                        o trabalho nao passou a exigencia declarada (crivo,
//                                 teste, RED antes do GREEN, area nova, escopo de
//                                 arquivos)
//   humano                        a parada foi PEDIDA por uma pessoa
//   excecao                       erro nao previsto que chegou ao catch
//   nao_classificado              sentinela: alguem gravou HALTED sem classe. Nao e
//                                 resposta, e defeito a consertar — e por isso a
//                                 escrita dele deixa linha no diario do card.
export const PARADA_SEM_CLASSE = 'nao_classificado'

export const CLASSES_DE_PARADA = [
  'transient', 'quota', 'terminal', 'orcamento', 'escopo', 'humano', 'excecao', PARADA_SEM_CLASSE,
] as const

export type ClasseDeParada = (typeof CLASSES_DE_PARADA)[number]

export function ehClasseDeParada(valor: string | undefined): valor is ClasseDeParada {
  return !!valor && (CLASSES_DE_PARADA as readonly string[]).includes(valor)
}

export const CLASSES_DE_ESPERA = ['timeout', 'taxa', 'rede'] as const

export type ClasseDeEspera = (typeof CLASSES_DE_ESPERA)[number]

export function ehClasseDeEspera(valor: string | undefined): valor is ClasseDeEspera {
  return !!valor && (CLASSES_DE_ESPERA as readonly string[]).includes(valor)
}

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
  waitClass?: ClasseDeEspera
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
