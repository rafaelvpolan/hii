import { anexarEvento } from '../euclides/eventos.ts'
import { TIERS, elevarTier, modeloDoTier, tierPara } from '../euclides/tesouro/orcamento.ts'
import type { EscolhaDeTier, Tier } from '../euclides/tesouro/orcamento.ts'
import { modelFor, providerNameFor } from '../tomada/registro.ts'
import type { AgentRole } from '../tomada/tipos.ts'
import { preferenciaDoPapel } from '../tomada/preferencias.ts'
import { readCard } from '../cordel/store.ts'
import type { Fields } from '../cordel/index.ts'

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

const ACAO_DO_AGENTE: Readonly<Record<string, string>> = {
  rufus: 'arquitetura',
  testudo: 'testes',
  escudo: 'seguranca',
  pura: 'limpeza',
  glossia: 'documentacao',
  limpio: 'reparo_build',
}

export function acaoDoAgente(agente: string): string {
  return ACAO_DO_AGENTE[agente] ?? ''
}

export function tierDaAcaoDoCard(acao: string, fm: Fields): EscolhaDeTier {
  return tierDoCard(acao, { pedidoDoCard: fm.tier, leiForcou: fm.lei_forcou === 'completo' })
}

export function modeloGovernado(papel: AgentRole, acao: string, fm: Fields): string | undefined {
  const escolhaDoHumano = preferenciaDoPapel(papel).model
  if (escolhaDoHumano) return escolhaDoHumano
  if (acao) {
    const governado = modeloDoTier(providerNameFor(papel), tierDaAcaoDoCard(acao, fm).tier)
    if (governado) return governado
  }
  return modelFor(papel)
}

export function modeloDoPasso(agente: string, id: string): string | undefined {
  return modeloGovernado('step', acaoDoAgente(agente), readCard(id)?.fm ?? {})
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
