import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { memoArquivo, memoChave, memoTempo } from '../../tomada/eco/memo.ts'

export type { JanelaDeUso, PlanoDoProvedor } from '../../tomada/tipos.ts'
import type { JanelaDeUso, PlanoDoProvedor } from '../../tomada/tipos.ts'

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
  return process.env.HII_CLAUDE_CONFIG || join(homedir(), '.claude.json')
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
  return process.env.HII_KIMI_CONFIG || join(homedir(), '.kimi-code', 'config.toml')
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
// harness, em motor/tomada/harness/*.ts — este arquivo nao conhece mais nome de
// provedor nenhum.

export function raizDoCodex(): string {
  return process.env.CODEX_HOME || join(homedir(), '.codex')
}

export function codexAutenticado(): boolean {
  return existsSync(join(raizDoCodex(), 'auth.json'))
}

interface CodexJanela {
  used_percent?: number
  window_minutes?: number
  resets_at?: number
}

interface CodexUsoBruto {
  timestamp: string
  plano: string
  primario?: CodexJanela
  secundario?: CodexJanela
  contextoUsado: number
  contextoLimite: number
}

function ultimoJsonl(dir: string): string {
  let escolhido = ''
  let mtime = -1
  const visitar = (atual: string): void => {
    let entradas
    try { entradas = readdirSync(atual, { withFileTypes: true, encoding: 'utf8' }) } catch { return }
    for (const entrada of entradas) {
      const caminho = join(atual, entrada.name)
      if (entrada.isDirectory()) { visitar(caminho); continue }
      if (!entrada.name.endsWith('.jsonl')) continue
      try {
        const quando = statSync(caminho).mtimeMs
        if (quando > mtime) { mtime = quando; escolhido = caminho }
      } catch { void 0 }
    }
  }
  visitar(join(dir, 'sessions'))
  return escolhido
}

function lerUsoCodexNoDisco(dir: string): CodexUsoBruto | null {
  const arquivo = ultimoJsonl(dir)
  if (!arquivo) return null
  let linhas: string
  try { linhas = readFileSync(arquivo, 'utf8') } catch { return null }
  let achado: CodexUsoBruto | null = null
  for (const linha of linhas.split('\n')) {
    try {
      const evento = JSON.parse(linha) as {
        timestamp?: string
        type?: string
        payload?: {
          type?: string
          info?: { last_token_usage?: { total_tokens?: number }; model_context_window?: number }
          rate_limits?: { primary?: CodexJanela; secondary?: CodexJanela; plan_type?: string }
        }
      }
      const p = evento.payload
      const info = p?.info
      if (evento.type !== 'event_msg' || p?.type !== 'token_count' || !evento.timestamp || !info) continue
      const limite = Number(info.model_context_window) || 0
      const usado = Number(info.last_token_usage?.total_tokens) || 0
      const taxas = p.rate_limits
      if (!taxas && !limite) continue
      achado = {
        timestamp: evento.timestamp,
        plano: String(taxas?.plan_type ?? ''),
        primario: taxas?.primary,
        secundario: taxas?.secondary,
        contextoUsado: usado,
        contextoLimite: limite,
      }
    } catch { continue }
  }
  return achado
}

const usoCodex = memoChave(raizDoCodex, () => memoTempo(() => lerUsoCodexNoDisco(raizDoCodex()), 2000))

function isoDoEpoch(segundos: number | undefined): string {
  const ms = Number(segundos) * 1000
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : ''
}

function rotuloDaJanelaCodex(minutos: number | undefined): string {
  if (minutos === 300) return '5h'
  if (minutos === 10080) return '7d'
  if (minutos && minutos % 1440 === 0) return `${minutos / 1440}d`
  if (minutos && minutos % 60 === 0) return `${minutos / 60}h`
  return minutos ? `${minutos}min` : ''
}

function janelaCodex(janela: CodexJanela | undefined): JanelaDeUso | null {
  const rotulo = rotuloDaJanelaCodex(janela?.window_minutes)
  const percentual = Number(janela?.used_percent)
  if (!rotulo || !Number.isFinite(percentual)) return null
  return { rotulo, percentual, resetaEm: isoDoEpoch(janela?.resets_at) }
}

export function planoDoCodex(agoraMs: number = Date.now()): PlanoDoProvedor {
  const uso = usoCodex()()
  if (!uso) return { provedor: 'codex', plano: '', detalhe: '', janelas: [], medidoEm: '', idadeHoras: -1, modelos: [], leituraDePlano: false }
  const janelas = [janelaCodex(uso.primario), janelaCodex(uso.secundario)].filter((j): j is JanelaDeUso => !!j)
  const contexto = uso.contextoLimite > 0
    ? {
      usadoTokens: uso.contextoUsado,
      limiteTokens: uso.contextoLimite,
      percentual: (uso.contextoUsado / uso.contextoLimite) * 100,
      medidoEm: uso.timestamp,
    }
    : undefined
  const medidoEm = uso.timestamp
  const timestampMs = Date.parse(medidoEm)
  return {
    provedor: 'codex',
    plano: uso.plano,
    detalhe: uso.plano ? 'uso lido do historico local do Codex' : '',
    janelas,
    medidoEm,
    idadeHoras: Number.isFinite(timestampMs) ? (agoraMs - timestampMs) / 3600000 : -1,
    modelos: [],
    contexto,
    leituraDePlano: true,
  }
}
