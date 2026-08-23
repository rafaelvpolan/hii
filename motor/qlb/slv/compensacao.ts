import { anexarEvento, eventosDoCard } from '../../euc/eventos'
import type { EventoDoCard } from '../../euc/eventos'
import { efeitoJaProduzido } from './idempotencia'

// SLV — compensacao de falha parcial (padrao saga). Nem toda operacao deste
// motor tem rollback: nao existe "desfazer" um PR aberto do jeito que existe um
// ROLLBACK de banco. Onde nao ha rollback, o estado precisa ficar MARCADO como
// orfao para revisao humana — nunca silenciosamente ignorado, e nunca
// "resolvido" produzindo o efeito de novo.

export const TIPOS_DE_ORFAO = ['pr_orfao', 'notificacao_incerta'] as const

export type TipoDeOrfao = (typeof TIPOS_DE_ORFAO)[number]

export function marcarOrfao(card: string, tipo: TipoDeOrfao, detalhe: string): void {
  anexarEvento({ card, evento: 'orfao', chave: tipo, detalhe })
}

export function orfaosDoCard(card: string): EventoDoCard[] {
  return eventosDoCard(card).filter(e => e.evento === 'orfao')
}

export function temOrfao(card: string, tipo: TipoDeOrfao): boolean {
  return orfaosDoCard(card).some(e => e.chave === tipo)
}

export interface PrOrfao {
  readonly url: string
}

// O caso da tabela da Parte VI, secao 3: "PR aberto, card cai antes da parede
// humana fechar -> marcar pr_orfao, NAO abrir um segundo PR". Detecta pelo
// diario: o efeito consta, mas o card nao sabe dele.
export function prOrfaoDe(card: string, prUrlNoCard: string): PrOrfao | null {
  if (String(prUrlNoCard ?? '').trim()) return null
  const url = efeitoJaProduzido(card, 'ctr', 'pr_create')
  return url ? { url } : null
}
