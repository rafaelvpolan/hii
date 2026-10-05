import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, numeroDeEnv } from '../../cordel/alicerce/config.ts'
import { ENV_TIER_FILE } from '../../cordel/alicerce/contrato.ts'
import { ehEsforco, ESFORCOS } from '../../tomada/preferencias.ts'
import type { Esforco } from '../../tomada/preferencias.ts'

// Tesouro — governanca de custo como DADO versionado, nao habito no codigo.
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
  'reparo_build', 'testes', 'documentacao', 'limpeza', 'classificacao', 'avaliacao',
] as const

export interface CriterioDeTier {
  readonly tier: Tier
  readonly motivo: string
}

export interface OrcamentoPorCard {
  readonly tetoUsd: number
  readonly acaoAoEstourar: string
  readonly tetoTokens?: number
}

export type ModelosPorProvedor = Readonly<Record<string, Readonly<Partial<Record<Tier, string>>>>>

export interface OrcamentoGlobal {
  readonly tetoUsd: number
  readonly janela: string
}

export interface Governanca {
  readonly versao: number
  readonly padrao: Tier
  readonly criterios: Readonly<Record<string, CriterioDeTier>>
  readonly orcamentoPorCard: OrcamentoPorCard
  readonly modelosPorTier: ModelosPorProvedor
  readonly esforcosPorTier: Readonly<Partial<Record<Tier, Esforco>>>
  readonly orcamentoGlobal: OrcamentoGlobal | null
}

interface Cru {
  versao?: number
  padrao?: string
  criterios?: Record<string, { tier?: string; motivo?: string }>
  orcamentoPorCard?: { tetoUsd?: number; acaoAoEstourar?: string; tetoTokens?: number }
  modelosPorTier?: { porProvedor?: Record<string, Record<string, string>> }
  esforcosPorTier?: Record<string, string>
  orcamentoGlobal?: { tetoUsd?: number; janela?: string }
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
  const teto = cru.orcamentoPorCard?.tetoUsd
  const acaoAoEstourar = cru.orcamentoPorCard?.acaoAoEstourar ?? ''
  if (typeof teto !== 'number' || !Number.isFinite(teto) || teto <= 0 || !acaoAoEstourar) {
    throw new Error(`model-tier.json: orcamentoPorCard precisa de tetoUsd numero finito > 0 e acaoAoEstourar — recebido ${JSON.stringify(teto)}. Teto infinito ou de outro tipo e a ausencia de orcamento com outro nome`)
  }
  const tetoTokens = cru.orcamentoPorCard?.tetoTokens ?? 0
  if (typeof tetoTokens !== 'number' || !Number.isFinite(tetoTokens) || tetoTokens < 0) {
    throw new Error(`model-tier.json: orcamentoPorCard.tetoTokens precisa ser numero finito >= 0 (0 = desligado) — recebido ${JSON.stringify(tetoTokens)}`)
  }
  return { versao: cru.versao ?? 0, padrao, criterios, orcamentoPorCard: { tetoUsd: teto, acaoAoEstourar, tetoTokens }, modelosPorTier: lerModelosPorTier(cru), esforcosPorTier: lerEsforcosPorTier(cru), orcamentoGlobal: lerOrcamentoGlobal(cru) }
}

function lerEsforcosPorTier(cru: Cru): Readonly<Partial<Record<Tier, Esforco>>> {
  const porTier: Partial<Record<Tier, Esforco>> = {}
  for (const [tier, esforco] of Object.entries(cru.esforcosPorTier ?? {})) {
    if (!ehEsforco(esforco)) {
      throw new Error(`model-tier.json: esforcosPorTier.${tier} precisa de um esforco valido (${ESFORCOS.join(' | ')}) — recebido ${JSON.stringify(esforco)}`)
    }
    porTier[exigirTier(tier, 'esforcosPorTier')] = esforco
  }
  return porTier
}

export function esforcoDoTier(tier: Tier, g: Governanca = lerGovernanca()): Esforco | undefined {
  return g.esforcosPorTier[tier]
}

function lerOrcamentoGlobal(cru: Cru): OrcamentoGlobal | null {
  if (!cru.orcamentoGlobal) return null
  const teto = cru.orcamentoGlobal.tetoUsd
  const janela = String(cru.orcamentoGlobal.janela ?? '24h')
  if (typeof teto !== 'number' || !Number.isFinite(teto) || teto < 0) {
    throw new Error(`model-tier.json: orcamentoGlobal.tetoUsd precisa ser numero finito >= 0 (0 = desligado) — recebido ${JSON.stringify(teto)}`)
  }
  return { tetoUsd: teto, janela }
}

function lerModelosPorTier(cru: Cru): ModelosPorProvedor {
  const porProvedor: Record<string, Partial<Record<Tier, string>>> = {}
  for (const [provedor, mapa] of Object.entries(cru.modelosPorTier?.porProvedor ?? {})) {
    const porTier: Partial<Record<Tier, string>> = {}
    for (const [tier, modelo] of Object.entries(mapa ?? {})) {
      if (!modelo || typeof modelo !== 'string') {
        throw new Error(`model-tier.json: modelosPorTier.porProvedor.${provedor}.${tier} precisa de um nome de modelo nao-vazio`)
      }
      porTier[exigirTier(tier, `modelosPorTier.porProvedor.${provedor}`)] = modelo
    }
    porProvedor[provedor] = porTier
  }
  return porProvedor
}

export function modeloDoTier(provedor: string, tier: Tier, g: Governanca = lerGovernanca()): string | undefined {
  return g.modelosPorTier[provedor]?.[tier]
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

// Le o gasto acumulado do card. `null` significa "o campo existe e NAO e numero",
// que e diferente de "gastou zero".
//
// Todo portao de orcamento fazia `parseFloat(fm.cost_usd || '0') || 0`, entao
// cost_usd corrompido ('abc', '1,50', truncado) virava 0 — "nao gastou nada" — e
// a guarda LIBERAVA a proxima chamada paga em vez de parar. Corrompido com a
// mesma representacao de ausente, num portao de gasto.
export function gastoDoCard(cru: string | undefined): number | null {
  const t = String(cru ?? '').trim()
  if (!t) return 0
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export function tetoDoCard(g: Governanca = lerGovernanca()): number {
  const doOperador = numeroDeEnv('HII_CARD_BUDGET_USD', 0)
  return doOperador > 0 ? doOperador : g.orcamentoPorCard.tetoUsd
}

export function tetoDeTokensDoCard(g: Governanca = lerGovernanca()): number {
  const doOperador = numeroDeEnv('HII_CARD_BUDGET_TOKENS', 0)
  return doOperador > 0 ? doOperador : g.orcamentoPorCard.tetoTokens ?? 0
}

export interface ConsumoDoCard {
  readonly usd: number | null
  readonly tokens: number
}

export function consumoDoCard(fm: { cost_usd?: string; tokens_total?: string }): ConsumoDoCard {
  const tokens = Number(fm.tokens_total || '0')
  return { usd: gastoDoCard(fm.cost_usd), tokens: Number.isFinite(tokens) && tokens > 0 ? tokens : 0 }
}

export function motivoDeOrcamentoExcedido(consumo: ConsumoDoCard, g: Governanca = lerGovernanca()): string {
  if (consumo.usd === null) return 'cost_usd nao e numero — sem saber o gasto, a proxima chamada paga nao e liberada'
  const tetoUsd = tetoDoCard(g)
  if (tetoUsd > 0 && consumo.usd >= tetoUsd) return `limite de custo da execucao atingido (US$ ${consumo.usd.toFixed(4)} de US$ ${tetoUsd})`
  return motivoDeTokensExcedidos(consumo.tokens, g)
}

export function motivoDeTokensExcedidos(tokens: number, g: Governanca = lerGovernanca()): string {
  const teto = tetoDeTokensDoCard(g)
  if (teto > 0 && tokens >= teto) return `limite de tokens da execucao atingido (${tokens} de ${teto}) — vale para todo provedor, inclusive os que nao informam custo em dolar`
  return ''
}
