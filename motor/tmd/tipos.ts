import type { Usage } from '../cdl'

export type AgentRole = 'implement' | 'verify' | 'gate' | 'step'

// Ainda uniao fechada: abre para string registravel no commit 2.2, junto
// com o registro por Map.
export type HarnessId = 'claude' | 'codex' | 'ollama' | 'kimi'

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
// tabela central, porque tabela central obriga a tocar em cic/ toda vez que um
// harness novo entra — e o contrato da Onda 2 e "um arquivo novo + uma linha".
export interface SinaisDoHarness {
  readonly terminal: readonly SinalDeFalha[]
  readonly quota: readonly SinalDeFalha[]
  readonly transient: readonly SinalDeFalha[]
}

export const SEM_SINAIS: SinaisDoHarness = { terminal: [], quota: [], transient: [] }

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

export interface Harness {
  readonly name: HarnessId
  readonly supportsAgents: boolean
  readonly supportsVision: boolean
  readonly agentic: boolean
  capabilities(): HarnessCapabilities
  // true = alcancavel agora. Nunca devolve true por omissao: harness que nao
  // sabe se sondar declara isso em capabilities, nao mente aqui.
  healthCheck(): Promise<boolean>
  sinaisDeFalha(): SinaisDoHarness
  run(req: AgentRequest): Promise<AgentResult>
}
