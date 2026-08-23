import { anexarEvento } from '../euc/eventos'
import { TIERS, elevarTier, tierPara } from '../euc/tsr/orcamento'
import type { EscolhaDeTier, Tier } from '../euc/tsr/orcamento'

// RUI — Rui Barbosa: a camada que decide ANTES de rotear. Quanto vale gastar
// nesta acao, e por que.
//
// A regra e a mesma da LEI sobre perfil de risco, pelo mesmo motivo: o card
// pode SUBIR o tier, nunca baixar. Quem escreve o card muitas vezes e a propria
// IA, e um pedido de "tier barato" seria bypass de governanca com cara de
// economia. Tier invalido tambem nao baixa nada — fica o do catalogo, e o
// motivo registra a tentativa em vez de engoli-la.
//
// Todo motivo acumulado vai para o diario em model_tier_selected. Custo sem
// porque nao se audita, e auditabilidade e o ponto inteiro do item 19.

export interface PedidoDeEstrategia {
  readonly pedidoDoCard?: string
  readonly leiForcou?: boolean
}

const TIER_DA_LEI: Tier = 'tier1_caro'

function ehTier(v: string): v is Tier {
  return (TIERS as readonly string[]).includes(v)
}

function comPedidoDoCard(tier: Tier, doCard: string, motivos: string[]): Tier {
  if (!ehTier(doCard)) {
    motivos.push(`card pediu tier desconhecido "${doCard}" — ignorado, vale o catalogo`)
    return tier
  }
  const elevado = elevarTier(tier, doCard)
  motivos.push(elevado === doCard && doCard !== tier
    ? `card elevou para ${doCard}`
    : `card pediu ${doCard} e nao eleva — pedido de tier abaixo do catalogo nunca vale`)
  return elevado
}

export function tierDoCard(acao: string, pedido: PedidoDeEstrategia): EscolhaDeTier {
  const base = tierPara(acao)
  const motivos = [base.motivo]
  let tier = base.tier

  if (pedido.pedidoDoCard) tier = comPedidoDoCard(tier, pedido.pedidoDoCard, motivos)

  if (pedido.leiForcou) {
    const comLei = elevarTier(tier, TIER_DA_LEI)
    if (comLei !== tier) motivos.push(`LEI elevou o rigor do card — tier sobe junto para ${TIER_DA_LEI}`)
    tier = comLei
  }

  return { tier, motivo: motivos.join(' · ') }
}

export function registrarTier(card: string, acao: string, escolha: EscolhaDeTier): void {
  anexarEvento({
    card,
    evento: 'model_tier_selected',
    chave: acao,
    resultado: escolha.tier,
    detalhe: escolha.motivo,
  })
}
