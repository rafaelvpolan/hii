import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../../cdl/ali/config'
import { ENV_TIER_FILE } from '../../cdl/ali/contrato'

// TSR — governanca de custo como DADO versionado, nao habito no codigo.
//
// O tier ja era escolhido, so que implicitamente (implement no claude, gate no
// codex). Escolha implicita nao se audita e nao se discute: ninguem pergunta
// "por que seguranca custa caro?" para uma linha de codigo. Aqui cada acao
// declara tier E motivo, e o motivo vai junto no diario.
//
// A regra que importa e a mesma da LEI sobre risco: card ou regra inegociavel
// pode SUBIR o tier, nunca baixar. Roteamento mal calibrado para baixo nao
// economiza — a economia evapora em retry, escalonamento e regressao
// silenciosa, e ainda fica invisivel.

export const TIERS = ['tier3_barato', 'tier2_padrao', 'tier1_caro'] as const

export type Tier = (typeof TIERS)[number]

export const ACOES_GOVERNADAS = [
  'arquitetura', 'seguranca', 'review', 'implementacao',
  'reparo_build', 'testes', 'documentacao', 'cleanup', 'classificacao',
] as const

export interface CriterioDeTier {
  readonly tier: Tier
  readonly motivo: string
}

export interface OrcamentoPorCard {
  readonly tetoUsd: number
  readonly acaoAoEstourar: string
}

export interface Governanca {
  readonly versao: number
  readonly padrao: Tier
  readonly criterios: Readonly<Record<string, CriterioDeTier>>
  readonly orcamentoPorCard: OrcamentoPorCard
}

interface Cru {
  versao?: number
  padrao?: string
  criterios?: Record<string, { tier?: string; motivo?: string }>
  orcamentoPorCard?: { tetoUsd?: number; acaoAoEstourar?: string }
}

export function arquivoDeGovernanca(): string {
  return process.env[ENV_TIER_FILE] || join(ROOT, 'config', 'model-tier.json')
}

function ehTier(v: string | undefined): v is Tier {
  return v !== undefined && (TIERS as readonly string[]).includes(v)
}

function exigirTier(valor: string | undefined, onde: string): Tier {
  if (!ehTier(valor)) {
    throw new Error(`model-tier.json: tier desconhecido em ${onde}: "${String(valor)}" (esperado ${TIERS.join(' | ')})`)
  }
  return valor
}

export function lerGovernanca(): Governanca {
  const caminho = arquivoDeGovernanca()
  if (!existsSync(caminho)) {
    throw new Error(`model-tier.json nao encontrado em ${caminho} — sem governanca escrita o custo volta a ser decidido por habito`)
  }
  let cru: Cru
  try {
    cru = JSON.parse(readFileSync(caminho, 'utf8')) as Cru
  } catch (e) {
    throw new Error(`model-tier.json ilegivel (${String((e as Error).message)})`)
  }
  const padrao = exigirTier(cru.padrao, 'padrao')
  const criterios: Record<string, CriterioDeTier> = {}
  for (const [acao, c] of Object.entries(cru.criterios ?? {})) {
    if (!c.motivo) throw new Error(`model-tier.json: acao "${acao}" sem motivo — tier sem porque nao e auditavel`)
    criterios[acao] = { tier: exigirTier(c.tier, `criterios.${acao}`), motivo: c.motivo }
  }
  const teto = cru.orcamentoPorCard?.tetoUsd ?? 0
  const acaoAoEstourar = cru.orcamentoPorCard?.acaoAoEstourar ?? ''
  if (!(teto > 0) || !acaoAoEstourar) {
    throw new Error('model-tier.json: orcamentoPorCard precisa de tetoUsd > 0 e acaoAoEstourar — orcamento opcional nao e orcamento')
  }
  return { versao: cru.versao ?? 0, padrao, criterios, orcamentoPorCard: { tetoUsd: teto, acaoAoEstourar } }
}

export function elevarTier(atual: Tier, pedido: Tier): Tier {
  return TIERS.indexOf(pedido) > TIERS.indexOf(atual) ? pedido : atual
}

export interface EscolhaDeTier {
  readonly tier: Tier
  readonly motivo: string
}

export function tierPara(acao: string, g: Governanca = lerGovernanca()): EscolhaDeTier {
  const declarado = g.criterios[acao]
  if (declarado) return declarado
  return { tier: g.padrao, motivo: `acao "${acao}" nao esta no catalogo — tier padrao do arquivo` }
}

export function tetoDoCard(g: Governanca = lerGovernanca()): number {
  return g.orcamentoPorCard.tetoUsd
}
