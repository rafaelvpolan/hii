import type { Usage } from '../cordel/index.ts'

export type AgentRole = 'implement' | 'verify' | 'gate' | 'step'

// Aberto de proposito: registrar um harness novo e criar um arquivo em
// motor/tomada/harness/ e somar uma linha em registro.ts. Nenhuma uniao fechada
// pra atualizar, nenhuma tabela central pra preencher.
export type HarnessId = string

export type AgentMode = 'edit' | 'readonly'

export interface AgentRequest {
  prompt: string
  cwd: string
  dirs: string[]
  mode: AgentMode
  useAgents: boolean
  model?: string
  effort?: string
  modo?: string
  timeoutMs: number
  liveLog?: string
  extraTools?: string[]
  agentsJson?: string
}

export interface AgentResult {
  ok: boolean
  failed: boolean
  timedOut: boolean
  isError: boolean
  detail: string
  text: string
  cost: number
  costMeasured: boolean
  usage: Usage
}

export interface SinalDeFalha {
  readonly pattern: RegExp
  readonly reason: string
}

// O que este harness sabe dizer sobre as proprias falhas. Fica AQUI, e nao numa
// tabela central, porque tabela central obriga a tocar em ciclo/ toda vez que um
// harness novo entra — e o contrato da Onda 2 e "um arquivo novo + uma linha".
export interface SinaisDoHarness {
  readonly terminal: readonly SinalDeFalha[]
  readonly quota: readonly SinalDeFalha[]
  readonly transient: readonly SinalDeFalha[]
}

// O que o harness PODE, declarado por ele mesmo. Obrigatorio de proposito: antes
// era `limits?` opcional, e nao declarar valia como "pode tudo" — permissividade
// silenciosa, exatamente o que este motor nao aceita em gate nenhum.
export interface HarnessCapabilities {
  readonly restrictsTools: boolean
  readonly isolatesReadonly: boolean
  readonly acceptsEffort: boolean
  readonly reportsCostUsd: boolean
  readonly reportsTokens: boolean
  readonly mcp: boolean
}

export interface CatalogoDeModo {
  readonly modos: readonly string[]
  readonly padrao: string
}

export interface CorDeMarca {
  readonly r: number
  readonly g: number
  readonly b: number
}

export interface JanelaDeUso {
  rotulo: string
  percentual: number
  resetaEm: string
}

export interface PlanoDoProvedor {
  provedor: string
  plano: string
  detalhe: string
  janelas: JanelaDeUso[]
  medidoEm: string
  idadeHoras: number
  modelos: string[]
}

export const SEM_PLANO: PlanoDoProvedor = {
  provedor: '', plano: '', detalhe: '', janelas: [], medidoEm: '', idadeHoras: -1, modelos: [],
}

// Tudo que o motor precisa saber SOBRE um harness mora aqui, declarado pelo
// proprio harness. Antes estava espalhado em tabelas centrais e cadeias
// `if (nome === 'claude')` em sete arquivos, inclusive fora de tomada/ — o que
// fazia "adicionar uma IA" ser uma caca ao tesouro pelo repositorio.
export interface Harness {
  readonly name: HarnessId
  readonly supportsAgents: boolean
  readonly supportsVision: boolean
  readonly agentic: boolean
  readonly modos: CatalogoDeModo
  readonly cor: CorDeMarca
  readonly binario: string
  // false = nao se instala como CLI no PATH (ex: servidor local)
  readonly exigeCliNoPath: boolean
  // [] = nao tem login proprio
  readonly comandoDeLogin: readonly string[]
  // false = nao ha de onde ler plano/uso; o painel mostra vazio em vez de zero
  readonly temLeitorDePlano: boolean
  // true = servidor/modelo na propria maquina, sem conta na nuvem nem tier pago
  readonly rodaLocal: boolean

  capabilities(): HarnessCapabilities
  // true = alcancavel agora. Nunca devolve true por omissao: harness que nao
  // sabe se sondar declara isso em capabilities, nao mente aqui.
  healthCheck(): Promise<boolean>
  sinaisDeFalha(): SinaisDoHarness
  // Mensagem de "como resolver" quando o binario nao esta no PATH.
  comoObterQuandoAusente(): string
  // true tambem quando o harness nao exige autenticacao nenhuma.
  autenticado(): boolean
  plano(agoraMs: number): PlanoDoProvedor
  modelosDisponiveis(): string[]
  // Leitura SINCRONA de prontidao, para o painel. Quem faz I/O e o healthCheck.
  prontoParaUso(): boolean
  // Modelo que este harness usa para o papel, quando o humano nao escolheu um.
  // Cada harness decide se le variavel de ambiente e qual — nao ha convencao
  // central que valha para todos.
  modeloPadraoPara(papel: AgentRole): string | undefined
  run(req: AgentRequest): Promise<AgentResult>
}
