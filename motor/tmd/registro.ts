import { GATE_MODEL, VERIFY_MODEL } from '../cdl/ali/config'
import { ClaudeProvider } from './harness/claude'
import { CodexProvider } from './harness/codex'
import { OllamaProvider } from './harness/ollama'
import { KimiProvider } from './harness/kimi'
import type { AgentRole, Harness, HarnessId, HarnessCapabilities } from './tipos'
import { preferenciaDoPapel, esforcoPara } from './preferencias'
import { modoResolvido, temModos } from './modos'

export const DEFAULT_PROVIDER: HarnessId = 'claude'

const PROVIDERS: Record<HarnessId, Harness> = {
  claude: new ClaudeProvider(),
  codex: new CodexProvider(),
  ollama: new OllamaProvider(),
  kimi: new KimiProvider(),
}

const ROLE_PROVIDER_ENV: Record<AgentRole, string> = {
  implement: 'HICODE_IMPLEMENT_PROVIDER',
  verify: 'HICODE_VERIFY_PROVIDER',
  gate: 'HICODE_GATE_PROVIDER',
  step: 'HICODE_STEP_PROVIDER',
}

const PROVIDER_MODEL_ENV: Record<Exclude<HarnessId, 'claude'>, string> = {
  codex: 'HICODE_CODEX_MODEL',
  ollama: 'HICODE_OLLAMA_MODEL',
  kimi: 'HICODE_KIMI_MODEL',
}

export function isProviderName(s: string | undefined): s is HarnessId {
  return s !== undefined && Object.prototype.hasOwnProperty.call(PROVIDERS, s)
}

export function providerNames(): HarnessId[] {
  return Object.keys(PROVIDERS) as HarnessId[]
}

export function agentRoles(): AgentRole[] {
  return Object.keys(ROLE_PROVIDER_ENV) as AgentRole[]
}

export function roleProviderEnv(role: AgentRole): string {
  return ROLE_PROVIDER_ENV[role]
}

export function roleQuotaFallbackEnv(role: AgentRole): string {
  return `HICODE_${role.toUpperCase()}_QUOTA_FALLBACK_PROVIDER`
}

export function providerNameFor(role: AgentRole, override?: string): HarnessId {
  if (isProviderName(override)) return override
  const escolhido = preferenciaDoPapel(role).provider
  if (isProviderName(escolhido)) return escolhido
  const perRole = process.env[ROLE_PROVIDER_ENV[role]]
  if (isProviderName(perRole)) return perRole
  const dflt = process.env.HICODE_AI_PROVIDER
  return isProviderName(dflt) ? dflt : DEFAULT_PROVIDER
}

export function providerFor(role: AgentRole, override?: string): Harness {
  return PROVIDERS[providerNameFor(role, override)]
}

export function harnessPorNome(name: HarnessId): Harness {
  return PROVIDERS[name]
}

export function providerLimits(name: HarnessId): HarnessCapabilities {
  return PROVIDERS[name].capabilities()
}

// Sonda de alcancabilidade. Mora aqui, e nao em sonda.ts, porque quem conhece os
// harnesses e o registro — sonda.ts virou so o helper HTTP compartilhado.
// Harness desconhecido devolve true de proposito: nao saber sondar nao pode
// impedir um card de acordar (mesmo comportamento de antes).
export async function probeProviderHealth(nome: string): Promise<boolean> {
  if (!isProviderName(nome)) return true
  return PROVIDERS[nome].healthCheck()
}

export function modelFor(role: AgentRole, override?: string): string | undefined {
  const name = providerNameFor(role, override)
  const escolhido = name === providerNameFor(role) ? preferenciaDoPapel(role).model : undefined
  if (escolhido) return escolhido
  if (name === 'claude') {
    if (role === 'verify') return VERIFY_MODEL
    if (role === 'gate') return GATE_MODEL
    return undefined
  }
  return process.env[PROVIDER_MODEL_ENV[name]] || undefined
}

export function effortFor(role: AgentRole, doCard?: string): string | undefined {
  return esforcoPara(role, doCard)
}

export function modoFor(role: AgentRole, override?: string): string | undefined {
  const provider = providerNameFor(role, override)
  if (!temModos(provider)) return undefined
  return modoResolvido(provider, preferenciaDoPapel(role).modo)
}

export function quotaFallbackProviderFor(role: AgentRole): HarnessId | null {
  const env = process.env[roleQuotaFallbackEnv(role)]
  return isProviderName(env) ? env : null
}
