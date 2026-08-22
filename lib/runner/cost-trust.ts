import { isoNow } from '../card'
import type { Fields } from '../card'
import { classifyFailure } from '../ai/failure'
import type { AgentRequest, AgentResult, AiProvider } from '../ai/types'
import { COST_UNKNOWN } from '../ai/cost'
import { emptyUsage } from '../ai/usage'
import { patchCard, patchCardWith, readCard } from './card-store'
import { addProvider, classifyCostGap, floorProviders, formatProviders, parseProviders, removeProvider } from './cost-gap'
import { registrarChamada, sessaoDoCard } from './ias-da-sessao'
import type { PapelDeChamada } from './ias-da-sessao'
import { sessaoAtual } from './sessao'
import { sumTokens } from '../ai/usage'
import { atualizarRegistroDeConversa } from './runs'

function semReporte(fm: Fields, provider: string): boolean {
  return parseProviders(fm.cost_unverified).includes(provider)
}

function noPiso(fm: Fields, provider: string): boolean {
  return parseProviders(fm.cost_floor).includes(provider)
}

function linhaDeLimpeza(fm: Fields, provider: string): string {
  const resto = formatProviders(removeProvider(fm.cost_unverified, provider))
  const cauda = resto ? `; segue sem reporte: ${resto}` : ''
  return `${isoNow()} custo medido: ${provider} informou o gasto desta chamada — marca de custo nao reportado retirada (o cost_usd deste card segue sendo piso)${cauda}`
}

export function markCostUnverified(id: string, provider: string): void {
  if (!id || !provider) return
  patchCardWith(
    id,
    (fm): Fields => (semReporte(fm, provider)
      ? {}
      : {
        cost_unverified: formatProviders(addProvider(fm.cost_unverified, provider)),
        cost_floor: formatProviders(addProvider(fm.cost_floor, provider)),
      }),
    fm => (semReporte(fm, provider)
      ? ''
      : `${isoNow()} custo NAO reportado: a chamada a ${provider} terminou sem informar gasto — o cost_usd deste card e piso medido, nao o total`),
  )
}

export function markCostFloor(id: string, provider: string): void {
  if (!id || !provider) return
  if (noPiso(readCard(id)?.fm ?? {}, provider)) return
  patchCardWith(
    id,
    (fm): Fields => (noPiso(fm, provider) ? {} : { cost_floor: formatProviders(addProvider(fm.cost_floor, provider)) }),
    fm => (noPiso(fm, provider)
      ? ''
      : `${isoNow()} chamada a ${provider} terminou sem concluir — o gasto ate a interrupcao nao foi reportado e nao entra no cost_usd, que segue sendo piso`),
  )
}

export function clearCostUnverified(id: string, provider: string): void {
  if (!id || !provider) return
  if (!semReporte(readCard(id)?.fm ?? {}, provider)) return
  patchCardWith(
    id,
    (fm): Fields => (semReporte(fm, provider) ? { cost_unverified: formatProviders(removeProvider(fm.cost_unverified, provider)) } : {}),
    fm => (semReporte(fm, provider) ? linhaDeLimpeza(fm, provider) : ''),
  )
}

export function recordCostTrust(id: string, provider: string, res: AgentResult): void {
  const gap = classifyCostGap(res)
  if (gap === 'measured') clearCostUnverified(id, provider)
  else if (gap === 'unreported') markCostUnverified(id, provider)
  else if (gap === 'call_failed') markCostFloor(id, provider)
}

export function recusaPorLimite(provider: AiProvider, req: AgentRequest): string {
  const limites = provider.limits
  if (!limites) return ''
  if (req.mode === 'readonly' && !limites.isolatesReadonly) {
    return `${provider.name} nao sabe rodar em modo somente-leitura (nao restringe ferramenta) — um papel de verificacao nele poderia editar arquivo`
  }
  return ''
}

export function sessaoParaChamada(id: string): string {
  return id ? sessaoDoCard(id) : `conversa-${sessaoAtual()}`
}

function semPropagarFalhaDeRegistro(registro: () => void): void {
  try {
    registro()
  } catch {
    return
  }
}

function anotarChamada(id: string, provider: AiProvider, req: AgentRequest, papel: PapelDeChamada, res: AgentResult, t0: number): void {
  semPropagarFalhaDeRegistro(() => {
    registrarChamada(sessaoParaChamada(id), {
      ts: isoNow(),
      papel,
      provedor: provider.name,
      modelo: req.model ?? '',
      custoUsd: Number(res.cost) || 0,
      custoMedido: classifyCostGap(res) === 'measured',
      tokens: sumTokens(res.usage),
      tokensEntrada: res.usage.tokens_in || 0,
      tokensSaida: res.usage.tokens_out || 0,
      tokensCache: res.usage.tokens_cache_create || 0,
      duracaoS: Math.round((Date.now() - t0) / 1000),
      ok: res.ok === true,
      classeDeFalha: res.ok === true
        ? ''
        : classifyFailure(provider.name, { timedOut: res.timedOut, detail: res.detail, text: res.text }).failureClass,
    })
    if (!id) atualizarRegistroDeConversa(sessaoParaChamada(id))
  })
}

export async function runProvider(id: string, provider: AiProvider, req: AgentRequest, papel: PapelDeChamada = 'desconhecido'): Promise<AgentResult> {
  const recusa = recusaPorLimite(provider, req)
  if (recusa) {
    return {
      ok: false,
      failed: true,
      timedOut: false,
      isError: false,
      detail: recusa,
      text: '',
      ...COST_UNKNOWN,
      usage: emptyUsage(),
    }
  }
  const t0 = Date.now()
  const res = await provider.run(req)
  recordCostTrust(id, provider.name, res)
  anotarChamada(id, provider, req, papel, res, t0)
  return res
}

export function warnBudgetWithoutGuarantee(id: string, fm: Fields, budgetUsd: number): void {
  const provedores = formatProviders(floorProviders(fm))
  if (!provedores || budgetUsd <= 0) return
  patchCard(id, {}, `${isoNow()} teto de US$${budgetUsd} SEM GARANTIA: ao menos uma chamada a ${provedores} terminou sem reportar gasto — US$${fm.cost_usd || '0'} e piso medido; o total real deste card nao e verificavel`)
}
