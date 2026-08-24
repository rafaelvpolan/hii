import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { memoArquivo } from '../../tmd/eco/memo.ts'

export type { JanelaDeUso, PlanoDoProvedor } from '../../tmd/tipos.ts'
import type { JanelaDeUso, PlanoDoProvedor } from '../../tmd/tipos.ts'

const NOME_DO_TIER: Record<string, string> = {
  default_claude_max_5x: 'Max 5x',
  default_claude_max_20x: 'Max 20x',
  default_claude_pro: 'Pro',
  default_claude_free: 'Free',
}

interface UtilizacaoDeJanela {
  utilization?: number
  resets_at?: string
}

interface ContaOauth {
  billingType?: string
  seatTier?: string
  userRateLimitTier?: string
  organizationType?: string
  hasExtraUsageEnabled?: boolean
}

interface ClaudeConfig {
  oauthAccount?: ContaOauth
  cachedUsageUtilization?: {
    fetchedAtMs?: number
    utilization?: Record<string, UtilizacaoDeJanela | null>
  }
}

function arquivoDoClaude(): string {
  return process.env.HICODE_CLAUDE_CONFIG || join(homedir(), '.claude.json')
}

export function claudeAutenticado(): boolean {
  return !!lerClaude(arquivoDoClaude()).oauthAccount
}

function lerJson(caminho: string): ClaudeConfig {
  if (!existsSync(caminho)) return {}
  try {
    return JSON.parse(readFileSync(caminho, 'utf8')) as ClaudeConfig
  } catch {
    return {}
  }
}

const lerClaude = memoArquivo(caminho => caminho, lerJson)

export function nomeDoTier(tier: string | undefined): string {
  if (!tier) return ''
  return NOME_DO_TIER[tier] ?? tier
}

const ROTULO_DA_JANELA: Record<string, string> = {
  five_hour: '5h',
  seven_day: '7d',
  seven_day_opus: '7d opus',
  seven_day_sonnet: '7d sonnet',
}

export function janelasDe(util: Record<string, UtilizacaoDeJanela | null> | undefined): JanelaDeUso[] {
  if (!util) return []
  const out: JanelaDeUso[] = []
  for (const [chave, rotulo] of Object.entries(ROTULO_DA_JANELA)) {
    const j = util[chave]
    if (!j || typeof j.utilization !== 'number') continue
    out.push({ rotulo, percentual: j.utilization, resetaEm: j.resets_at ?? '' })
  }
  return out
}

export function planoDoClaude(agoraMs: number = Date.now()): PlanoDoProvedor {
  const d = lerClaude(arquivoDoClaude())
  const conta = d.oauthAccount ?? {}
  const cache = d.cachedUsageUtilization ?? {}
  const buscadoEm = cache.fetchedAtMs ?? 0
  const detalhes = [
    conta.organizationType === 'claude_team' ? 'Team' : '',
    conta.seatTier ?? '',
    conta.billingType === 'stripe_subscription' ? 'assinatura' : conta.billingType ?? '',
    conta.hasExtraUsageEnabled ? 'uso extra ligado' : '',
  ].filter(Boolean)
  return {
    provedor: 'claude',
    plano: nomeDoTier(conta.userRateLimitTier) || (conta.billingType ? 'assinatura' : ''),
    detalhe: detalhes.join(' · '),
    janelas: janelasDe(cache.utilization),
    medidoEm: buscadoEm ? new Date(buscadoEm).toISOString() : '',
    idadeHoras: buscadoEm ? (agoraMs - buscadoEm) / 3600000 : -1,
    modelos: [],
  }
}

function arquivoDoKimi(): string {
  return process.env.HICODE_KIMI_CONFIG || join(homedir(), '.kimi-code', 'config.toml')
}

export function modelosDoKimi(toml: string): string[] {
  return [...toml.matchAll(/^\s*display_name\s*=\s*"([^"]+)"/gm)].map(m => m[1] ?? '').filter(Boolean)
}

export function provedorDoKimi(toml: string): string {
  return (toml.match(/^\s*\[providers\."([^"]+)"\]/m) ?? [])[1] ?? ''
}

function lerToml(caminho: string): string {
  if (!existsSync(caminho)) return ''
  try {
    return readFileSync(caminho, 'utf8')
  } catch {
    return ''
  }
}

const lerKimi = memoArquivo(caminho => caminho, lerToml)

export function kimiAutenticado(): boolean {
  return !!provedorDoKimi(lerKimi(arquivoDoKimi()))
}

export function planoDoKimi(): PlanoDoProvedor {
  const toml = lerKimi(arquivoDoKimi())
  const provedor = provedorDoKimi(toml)
  return {
    provedor: 'kimi',
    plano: provedor ? (provedor.startsWith('managed:') ? 'gerenciado (oauth)' : 'chave propria') : '',
    detalhe: provedor,
    janelas: [],
    medidoEm: '',
    idadeHoras: -1,
    modelos: modelosDoKimi(toml),
  }
}

export function planoLocal(nome: string): PlanoDoProvedor {
  return { provedor: nome, plano: 'local, sem plano', detalhe: '', janelas: [], medidoEm: '', idadeHoras: -1, modelos: [] }
}

// Os leitores acima continuam morando aqui porque sao implementacao (parsear
// ~/.claude.json, parsear config.toml do kimi). Quem DIZ que os tem e cada
// harness, em motor/tmd/harness/*.ts — este arquivo nao conhece mais nome de
// provedor nenhum.

export function raizDoCodex(): string {
  return process.env.CODEX_HOME || join(homedir(), '.codex')
}

export function codexAutenticado(): boolean {
  return existsSync(join(raizDoCodex(), 'auth.json'))
}


