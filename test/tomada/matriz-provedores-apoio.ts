import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentRoles, effortFor, modelFor, modoFor } from '../../motor/tomada/registro.ts'
import type { AgentMode, AgentRequest, AgentRole } from '../../motor/tomada/tipos.ts'

const PATH_ORIGINAL = process.env.PATH ?? ''

function temBinario(nome: string): boolean {
  try {
    execFileSync(nome, ['--version'], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] })
    return true
  } catch {
    return false
  }
}

function saidaDeAjuda(binario: string, args: string[]): string {
  try {
    return execFileSync(binario, args, { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    const erro = e as { stdout?: string; stderr?: string }
    return `${erro.stdout ?? ''}${erro.stderr ?? ''}`
  }
}

export const TEM_CLAUDE = temBinario('claude')
export const TEM_KIMI = temBinario('kimi')
export const TEM_CODEX = temBinario('codex')
export const TEM_CURL = temBinario('curl')

export const AJUDA_CLAUDE = TEM_CLAUDE ? saidaDeAjuda('claude', ['--help']) : ''
export const AJUDA_KIMI = TEM_KIMI ? saidaDeAjuda('kimi', ['--help']) : ''
export const AJUDA_CODEX = TEM_CODEX ? saidaDeAjuda('codex', ['exec', '--help']) : ''
export const AJUDA_CURL = TEM_CURL ? saidaDeAjuda('curl', ['--help', 'all']) : ''

const HOME_VAZIO = mkdtempSync(join(tmpdir(), 'hii-matriz-provedores-home-'))

const ENV_GUARDADAS = [
  'HICODE_IA_FILE', 'HICODE_EFFORT', 'HICODE_CODEX_MODEL', 'HICODE_KIMI_MODEL', 'HICODE_OLLAMA_MODEL',
  'HICODE_IMPLEMENT_PROVIDER', 'HICODE_VERIFY_PROVIDER', 'HICODE_GATE_PROVIDER', 'HICODE_STEP_PROVIDER', 'HICODE_AI_PROVIDER',
] as const

const ENV_ANTIGO = new Map<string, string | undefined>()
for (const chave of ENV_GUARDADAS) ENV_ANTIGO.set(chave, process.env[chave])
process.env.HICODE_IA_FILE = join(HOME_VAZIO, 'sem-preferencias.json')
delete process.env.HICODE_EFFORT
delete process.env.HICODE_CODEX_MODEL
delete process.env.HICODE_KIMI_MODEL
delete process.env.HICODE_OLLAMA_MODEL
delete process.env.HICODE_IMPLEMENT_PROVIDER
delete process.env.HICODE_VERIFY_PROVIDER
delete process.env.HICODE_GATE_PROVIDER
delete process.env.HICODE_STEP_PROVIDER
delete process.env.HICODE_AI_PROVIDER

export const BASE = mkdtempSync(join(tmpdir(), 'hii-matriz-provedores-'))
const binDir = join(BASE, 'bin')
mkdirSync(binDir, { recursive: true })
export const PATH_COM_FAKES = `${binDir}:${PATH_ORIGINAL}`
process.env.PATH = PATH_COM_FAKES

export function fakeBin(nome: string, script: string): void {
  const caminho = join(binDir, nome)
  writeFileSync(caminho, script)
  chmodSync(caminho, 0o755)
}

export async function comPathEmBranco<T>(fn: () => Promise<T>): Promise<T> {
  process.env.PATH = '/definitivamente/nao/existe/neste/host'
  try {
    return await fn()
  } finally {
    process.env.PATH = PATH_COM_FAKES
  }
}

export function restaurarAmbiente(): void {
  process.env.PATH = PATH_ORIGINAL
  for (const chave of ENV_GUARDADAS) {
    const valor = ENV_ANTIGO.get(chave)
    if (valor === undefined) delete process.env[chave]
    else process.env[chave] = valor
  }
  rmSync(BASE, { recursive: true, force: true })
  rmSync(HOME_VAZIO, { recursive: true, force: true })
}

export function pedidoSimples(extra: Partial<AgentRequest> = {}): AgentRequest {
  return { prompt: 'faca algo', cwd: BASE, dirs: [], mode: 'edit', useAgents: false, timeoutMs: 20000, ...extra }
}

export function pedidoReal(harnessNome: string, papel: AgentRole, modo: AgentMode, dirs: string[]): AgentRequest {
  return {
    prompt: 'ajuste o rodape da pagina',
    cwd: dirs[0] ?? '/wt',
    dirs,
    mode: modo,
    useAgents: false,
    model: modelFor(papel, harnessNome),
    effort: effortFor(papel),
    modo: modoFor(papel, harnessNome),
    timeoutMs: 20000,
  }
}

export const PAPEIS: AgentRole[] = agentRoles()
export const MODOS: AgentMode[] = ['edit', 'readonly']
