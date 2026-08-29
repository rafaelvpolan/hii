import { ClaudeProvider } from './harness/claude.ts'
import { CodexProvider } from './harness/codex.ts'
import { OllamaProvider } from './harness/ollama.ts'
import { KimiProvider } from './harness/kimi.ts'
import type { AgentRole, CorDeMarca, Harness, HarnessId, HarnessCapabilities } from './tipos.ts'
import { preferenciaDoPapel, esforcoPara } from './preferencias.ts'
import { resolverModo } from './modo-puro.ts'

export const DEFAULT_PROVIDER: HarnessId = 'claude'

// Registrar um harness novo = importar a classe e somar uma linha aqui.
// Nada mais no motor precisa saber que ele existe.
const PROVIDERS: ReadonlyMap<HarnessId, Harness> = new Map<HarnessId, Harness>(
  [new ClaudeProvider(), new CodexProvider(), new OllamaProvider(), new KimiProvider()]
    .map(h => [h.name, h]),
)

const ROLE_PROVIDER_ENV: Record<AgentRole, string> = {
  implement: 'HICODE_IMPLEMENT_PROVIDER',
  verify: 'HICODE_VERIFY_PROVIDER',
  gate: 'HICODE_GATE_PROVIDER',
  step: 'HICODE_STEP_PROVIDER',
}

// Nao e mais type predicate de proposito: com HarnessId = string, um predicado
// estreitaria o ramo negativo para `never` e quebraria todo `if/else` depois
// dele (motor/mirante/escolher-ia.ts era o caso real).
export function isProviderName(s: string | undefined): boolean {
  return s !== undefined && PROVIDERS.has(s)
}

export function providerNames(): HarnessId[] {
  return [...PROVIDERS.keys()]
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
  if (override !== undefined && isProviderName(override)) return override
  const escolhido = preferenciaDoPapel(role).provider
  if (escolhido !== undefined && isProviderName(escolhido)) return escolhido
  const perRole = process.env[ROLE_PROVIDER_ENV[role]]
  if (perRole !== undefined && isProviderName(perRole)) return perRole
  const dflt = process.env.HICODE_AI_PROVIDER
  return dflt !== undefined && isProviderName(dflt) ? dflt : DEFAULT_PROVIDER
}

export function providerFor(role: AgentRole, override?: string): Harness {
  return harnessPorNome(providerNameFor(role, override))
}

// Lanca em vez de devolver undefined: id desconhecido e erro de programacao,
// nao estado a ser tratado silenciosamente rio abaixo.
export function harnessPorNome(name: HarnessId): Harness {
  const h = PROVIDERS.get(name)
  if (!h) throw new Error(`harness nao registrado: ${name}`)
  return h
}

export function harnessSeExistir(name: string | undefined): Harness | undefined {
  return name === undefined ? undefined : PROVIDERS.get(name)
}

// --- acessores por nome, para quem so tem o id em maos (painel, CLI) ---

export function modosDoProvedor(nome: HarnessId): readonly string[] {
  return harnessSeExistir(nome)?.modos.modos ?? []
}

export function modoPadraoDoProvedor(nome: HarnessId): string {
  return harnessSeExistir(nome)?.modos.padrao ?? ''
}

export function temModos(nome: HarnessId): boolean {
  return modosDoProvedor(nome).length > 0
}

export function corDoHarness(nome: HarnessId): CorDeMarca {
  return harnessSeExistir(nome)?.cor ?? { r: 148, g: 163, b: 184 }
}

export function binarioDoHarness(nome: HarnessId): string {
  return harnessSeExistir(nome)?.binario ?? ''
}

export function binariosDeHarness(): string[] {
  return providerNames().map(binarioDoHarness).filter(Boolean)
}

export function comandoDeLoginDe(nome: HarnessId): readonly string[] {
  return harnessSeExistir(nome)?.comandoDeLogin ?? []
}

export function providerLimits(name: HarnessId): HarnessCapabilities {
  return harnessPorNome(name).capabilities()
}

// Sonda de alcancabilidade. Mora aqui, e nao em sonda.ts, porque quem conhece os
// harnesses e o registro — sonda.ts virou so o helper HTTP compartilhado.
// Harness desconhecido devolve true de proposito: nao saber sondar nao pode
// impedir um card de acordar (mesmo comportamento de antes).
export async function probeProviderHealth(nome: string): Promise<boolean> {
  const h = harnessSeExistir(nome)
  return h ? h.healthCheck() : true
}

export function sabeSondarProvedor(nome: string): boolean {
  return harnessSeExistir(nome) !== undefined
}

export function modelFor(role: AgentRole, override?: string): string | undefined {
  const name = providerNameFor(role, override)
  const escolhido = name === providerNameFor(role) ? preferenciaDoPapel(role).model : undefined
  if (escolhido) return escolhido
  return harnessSeExistir(name)?.modeloPadraoPara(role)
}

export function effortFor(role: AgentRole, doCard?: string): string | undefined {
  return esforcoPara(role, doCard)
}

export function modoFor(role: AgentRole, override?: string): string | undefined {
  const h = harnessSeExistir(providerNameFor(role, override))
  if (!h || !h.modos.modos.length) return undefined
  return resolverModo(h.modos, preferenciaDoPapel(role).modo)
}

export function quotaFallbackProviderFor(role: AgentRole): HarnessId | null {
  const env = process.env[roleQuotaFallbackEnv(role)]
  return env !== undefined && isProviderName(env) ? env : null
}
