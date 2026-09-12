// Rota — o decisor de troca de provedor quando a falha e recuperavel em OUTRO lugar.
//
// O contrato Harness sempre declarou capacidade (`agentic`, `capabilities()`,
// `autenticado()`, `rodaLocal`) e cota (`janelasDoProvedor`), mas ninguem consultava
// esses dados para ESCOLHER: `quotaFallbackProviderFor` lia uma env e devolvia o nome
// sem perguntar se o candidato edita arquivo, se esta logado ou se a cota dele tambem
// acabou — e o card batia na parede na segunda falha ("primeiro retry: fallback;
// segundo: parede").
//
// Este modulo e um decisor ADITIVO: nunca piora o comportamento atual, so acrescenta
// uma saida antes do HALT. Quem chama continua decidindo O QUE fazer com a decisao —
// e a troca automatica continua atras de HII_QUOTA_FALLBACK, que e interruptor do
// operador, nao deste modulo.
//
// Regras, todas com dado que o motor ja tem:
//   1. falha `terminal` nunca troca — repetir em outro provedor da o mesmo resultado.
//   2. candidatos em ordem: env do papel (a escolha explicita do operador vence),
//      depois `providers` da preferencia do papel, depois todos os registrados.
//   3. filtra quem ja falhou NESTA rodada, quem nao cumpre a exigencia do papel
//      (`implement` exige agentic; `verify` exige isolamento de leitura — a mesma
//      regra que euclides/tesouro/confianca.ts ja aplica para recusar), quem nao esta
//      autenticado e quem esta com a cota esgotada na janela corrente.
//   4. para papel mecanico (`step`, `verify`), quem roda local vem primeiro — e de
//      graca em dolar.
//   5. lista vazia -> mantem a politica atual. Nunca inventa provedor.

import type { AgentRole, HarnessId } from './tipos.ts'
import type { FailureClass } from '../cordel/index.ts'
import { harnessSeExistir, providerNames, quotaFallbackProviderFor } from './registro.ts'
import { preferenciaDoPapel } from './preferencias.ts'
import { cotaEsgotadaEm } from './disponibilidade.ts'

export interface EntradaDeRota {
  papel: AgentRole
  classeDeFalha: FailureClass
  provedorAtual: HarnessId
  tentadosNestaRodada: readonly HarnessId[]
}

export type DecisaoDeRota =
  | { acao: 'manter_politica_atual'; motivo: string }
  | { acao: 'trocar'; para: HarnessId; motivo: string }

export interface CandidatoDeRota {
  nome: HarnessId
  agentic: boolean
  isolaLeitura: boolean
  rodaLocal: boolean
  autenticado: boolean
  cotaEsgotada: boolean
}

export interface ConsultaDeRota {
  candidatosDoPapel(papel: AgentRole): HarnessId[]
  candidato(nome: HarnessId): CandidatoDeRota | undefined
}

function semRepetir(nomes: readonly HarnessId[]): HarnessId[] {
  return [...new Set(nomes)]
}

export function campoDeOverrideDoPapel(papel: AgentRole): string {
  return `provider_override_${papel}`
}

export function rotaTentadas(csv: string | undefined): HarnessId[] {
  return (csv ?? '').split(',').map(s => s.trim()).filter(Boolean)
}

export function comTentativaDeRota(csv: string | undefined, nome: HarnessId | undefined): string {
  return semRepetir([...rotaTentadas(csv), ...(nome ? [nome] : [])]).join(',')
}

export function consultaReal(): ConsultaDeRota {
  return {
    candidatosDoPapel(papel: AgentRole): HarnessId[] {
      const daEnv = quotaFallbackProviderFor(papel)
      const daPreferencia = (preferenciaDoPapel(papel).providers ?? []).filter(p => harnessSeExistir(p) !== undefined)
      return semRepetir([...(daEnv ? [daEnv] : []), ...daPreferencia, ...providerNames()])
    },
    candidato(nome: HarnessId): CandidatoDeRota | undefined {
      const h = harnessSeExistir(nome)
      if (!h) return undefined
      return {
        nome: h.name,
        agentic: h.agentic,
        isolaLeitura: h.capabilities().isolatesReadonly,
        rodaLocal: h.rodaLocal,
        autenticado: h.autenticado(),
        cotaEsgotada: cotaEsgotadaEm(h.name),
      }
    },
  }
}

function cumpreExigenciaDoPapel(papel: AgentRole, c: CandidatoDeRota): boolean {
  if (papel === 'implement') return c.agentic
  if (papel === 'verify') return c.isolaLeitura
  return true
}

function papelMecanico(papel: AgentRole): boolean {
  return papel === 'step' || papel === 'verify'
}

export function decidirRota(e: EntradaDeRota, consulta: ConsultaDeRota = consultaReal()): DecisaoDeRota {
  if (e.classeDeFalha === 'terminal') {
    return { acao: 'manter_politica_atual', motivo: 'falha terminal nao melhora trocando de provedor' }
  }
  const foraDaRodada = new Set<HarnessId>([e.provedorAtual, ...e.tentadosNestaRodada])
  const aptos = consulta
    .candidatosDoPapel(e.papel)
    .filter(nome => !foraDaRodada.has(nome))
    .map(nome => consulta.candidato(nome))
    .filter((c): c is CandidatoDeRota => c !== undefined)
    .filter(c => cumpreExigenciaDoPapel(e.papel, c))
    .filter(c => c.autenticado)
    .filter(c => !c.cotaEsgotada)
  const ordenados = papelMecanico(e.papel)
    ? [...aptos.filter(c => c.rodaLocal), ...aptos.filter(c => !c.rodaLocal)]
    : aptos
  const escolhido = ordenados[0]
  if (!escolhido) {
    return { acao: 'manter_politica_atual', motivo: `nenhum candidato apto para ${e.papel} fora de {${[...foraDaRodada].filter(Boolean).join(', ')}}` }
  }
  return { acao: 'trocar', para: escolhido.nome, motivo: `${escolhido.nome} esta apto para ${e.papel} (autenticado, cota ok${escolhido.rodaLocal ? ', roda local' : ''}) e ainda nao falhou nesta rodada` }
}
