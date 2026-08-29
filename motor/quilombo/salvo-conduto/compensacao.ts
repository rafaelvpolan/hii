import { anexarEvento, eventosDoCard } from '../../euclides/eventos.ts'
import type { EventoDoCard } from '../../euclides/eventos.ts'
import { efeitoJaProduzido, FASE_DO_CARTORIO } from './idempotencia.ts'

// Salvo-conduto — compensacao de falha parcial (padrao saga). Nem toda operacao deste
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

// O diario e um JSONL em disco, sem assinatura. Quem tiver escrita no
// diretorio de runs pode anexar um `efeito_registrado` forjado — e sem esta
// checagem `reconcileStranded` gravaria a url escolhida por ele direto no
// `pr_url` do card, que e o campo que o humano abre para revisar e mergear.
// Nao substitui integridade de verdade (assinar a linha), mas fecha o caminho
// de virar isca clicavel: so passa url de PR do proprio host git.
const URL_DE_PR = /^https:\/\/(github\.com|[a-z0-9.-]+\.githubusercontent\.com)\/[\w.-]+\/[\w.-]+\/pull\/\d+$/

export function ehUrlDePr(url: string): boolean {
  return URL_DE_PR.test(String(url ?? '').trim())
}

// O caso da tabela da Parte VI, secao 3: "PR aberto, card cai antes da parede
// humana fechar -> marcar pr_orfao, NAO abrir um segundo PR". Detecta pelo
// diario: o efeito consta, mas o card nao sabe dele.
export function prOrfaoDe(card: string, prUrlNoCard: string): PrOrfao | null {
  if (String(prUrlNoCard ?? '').trim()) return null
  const url = efeitoJaProduzido(card, FASE_DO_CARTORIO, 'pr_create')
  if (!url) return null
  if (!ehUrlDePr(url)) {
    // Registra e recusa. Sumir em silencio esconderia adulteracao do diario.
    marcarOrfao(card, 'notificacao_incerta', `diario tinha pr_create com valor que nao e url de PR: ${url.slice(0, 120)}`)
    return null
  }
  return { url }
}
