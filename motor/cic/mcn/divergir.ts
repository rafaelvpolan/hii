import { lerGovernanca, tetoDoCard } from '../../euc/tsr/orcamento.ts'
import type { Governanca } from '../../euc/tsr/orcamento.ts'
import { escolherEnquadramentos } from './enquadramentos.ts'
import type { Enquadramento } from './enquadramentos.ts'

// MCN — a metade DIVERGENTE. O que a distingue do TSL nao e o prompt: e que o
// isolamento entre ramos aqui e estrutural, nao prometido.
//
// "the generator-critic split is mechanical — separate LLM calls with opposite
// system prompts — not promised in one prompt." O mesmo vale entre os ramos:
// pedir a um modelo que "pense de N formas independentes" numa chamada so
// produz N variacoes do mesmo ancoramento, porque o contexto e um.
//
// Duas garantias, as duas verificadas por teste:
//
// 1. promptDoRamo() recebe UM enquadramento. Nao recebe a lista. Um ramo nao
//    consegue citar outro porque nao tem como saber que outro existe.
// 2. despacharDivergencia() constroi TODOS os prompts antes de despachar
//    qualquer um. Nenhuma saida pode entrar no prompt de outro ramo, porque no
//    instante em que os prompts existem ainda nao ha saida nenhuma.

export const RAMOS_PADRAO = Number(process.env.HICODE_MCN_RAMOS || 4)
export const IDEIAS_POR_RAMO = Number(process.env.HICODE_MCN_IDEIAS || 4)

export interface Ramo {
  readonly enquadramento: string
  readonly prompt: string
}

export interface SaidaDeRamo {
  readonly enquadramento: string
  readonly ok: boolean
  readonly texto: string
  readonly custoUsd: number
}

export interface Proposta {
  readonly enquadramento: string
  readonly texto: string
}

// O despachante e injetado, e nao importado, por dois motivos. Testar
// isolamento exige capturar o que foi enviado, e um modulo que fala com a rede
// por dentro nao deixa. E manter este arquivo puro deixa a regra de isolamento
// verificavel sem provedor de IA nenhum.
export type Despachante = (ramo: Ramo) => Promise<SaidaDeRamo>

export function promptDoRamo(e: Enquadramento, enunciado: string, quantas: number = IDEIAS_POR_RAMO): string {
  return [
    `Voce raciocina EXCLUSIVAMENTE pela lente: ${e.nome}.`,
    e.lente,
    '',
    `ENUNCIADO: ${enunciado}`,
    '',
    `Gere ${quantas} propostas DISTINTAS de como resolver, por essa lente.`,
    'As tres primeiras respostas obvias ja foram pensadas — passe delas.',
    'NAO avalie, NAO ranqueie, NAO escolha: outro agente faz isso, e sem apego.',
    'Responda APENAS um JSON numa linha: {"propostas":["proposta 1","proposta 2"]}',
  ].join('\n')
}

export interface OrcamentoDaDivergencia {
  readonly tetoUsd: number
  readonly gastoUsd: number
  readonly restanteUsd: number
  readonly porRamoUsd: number
  readonly ramos: number
}

// N ramos multiplicam o custo por N — e a unica parte do motor onde uma decisao
// de configuracao muda o gasto em ordem de grandeza. Por isso o teto aqui nao e
// recomendacao: sem ele, LANCA.
//
// lerGovernanca() ja reprova model-tier.json sem orcamentoPorCard. Nao repetimos
// a checagem: repetir criaria duas fontes de verdade para a mesma regra, e a
// segunda envelheceria calada.
export function orcamentoDaDivergencia(ramos: number, gastoUsd: number, g: Governanca = lerGovernanca()): OrcamentoDaDivergencia {
  if (!Number.isFinite(ramos) || ramos < 2) {
    throw new Error(`divergencia com ${String(ramos)} ramo(s) nao e divergencia — abaixo de 2 nao ha o que comparar`)
  }
  const tetoUsd = tetoDoCard(g)
  const restanteUsd = tetoUsd - gastoUsd
  if (restanteUsd <= 0) {
    throw new Error(`o card ja gastou US$${gastoUsd.toFixed(4)} do teto de US$${tetoUsd.toFixed(4)} — abrir ${ramos} ramos aqui estouraria o orcamento, e divergencia pela metade nao vale o que custa`)
  }
  const porRamoUsd = restanteUsd / ramos
  return { tetoUsd, gastoUsd, restanteUsd, porRamoUsd, ramos }
}

export function montarRamos(enunciado: string, enquadramentos: readonly Enquadramento[], quantas: number = IDEIAS_POR_RAMO): Ramo[] {
  if (!enunciado.trim()) throw new Error('divergencia sem enunciado — N lentes sobre nada devolvem N respostas sobre nada')
  // map sobre cada enquadramento isoladamente: promptDoRamo nao recebe o array.
  return enquadramentos.map(e => ({ enquadramento: e.id, prompt: promptDoRamo(e, enunciado, quantas) }))
}

export interface Divergencia {
  readonly ramos: readonly SaidaDeRamo[]
  readonly propostas: readonly Proposta[]
  readonly custoUsd: number
  readonly orcamento: OrcamentoDaDivergencia
}

export async function despacharDivergencia(
  enunciado: string,
  enquadramentos: readonly Enquadramento[],
  despachante: Despachante,
  gastoUsd = 0,
): Promise<Divergencia> {
  const orcamento = orcamentoDaDivergencia(enquadramentos.length, gastoUsd)
  // Os prompts existem ANTES do primeiro despacho. E aqui que o isolamento
  // deixa de ser promessa: nao ha instante em que uma saida esteja disponivel
  // para entrar no prompt de outro ramo.
  const ramos = montarRamos(enunciado, enquadramentos)
  const saidas = await Promise.all(ramos.map(r => despachante(r)))
  const propostas = saidas.flatMap(s => (s.ok ? parsePropostas(s.texto, s.enquadramento) : []))
  return {
    ramos: saidas,
    propostas,
    custoUsd: saidas.reduce((a, s) => a + s.custoUsd, 0),
    orcamento,
  }
}

interface PropostasBrutas {
  propostas?: string[]
}

export function parsePropostas(texto: string, enquadramento: string): Proposta[] {
  const m = texto.match(/\{[\s\S]*\}/)
  if (!m?.[0]) return []
  try {
    const j = JSON.parse(m[0]) as PropostasBrutas
    if (!Array.isArray(j.propostas)) return []
    return j.propostas
      .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
      .map(p => ({ enquadramento, texto: p.replace(/\s+/g, ' ').trim().slice(0, 300) }))
  } catch {
    return []
  }
}

export function enquadramentosParaCard(semente: string, quantos: number = RAMOS_PADRAO): Enquadramento[] {
  return escolherEnquadramentos(quantos, semente)
}
