import { anexarEvento } from '../euc/eventos'

// CIC — o repair loop generico. Uma tentativa DIRIGIDA por vez, com teto, e
// sempre reportando ao humano o que ja foi tentado quando esgota.
//
// Nao e um mecanismo novo: o motor ja tinha QUATRO copias deste padrao —
// buildWithReajuste, testGate, passoComCrivo e o conserto de URL. Eram
// estruturalmente iguais e divergiam no que importa (o que conta como falha,
// se o relato sobe pro humano, se o evento vai pro diario). Isto e a versao
// unica; as copias passam a chamar aqui.

export type StatusDoGate = 'ok' | 'falhou' | 'inconclusivo'

export interface VeredictoDeGate {
  readonly status: StatusDoGate
  readonly detalhe: string
}

export const APROVADO: VeredictoDeGate = { status: 'ok', detalhe: '' }

export function reprovado(detalhe: string): VeredictoDeGate {
  return { status: 'falhou', detalhe }
}

export function inconclusivo(detalhe: string): VeredictoDeGate {
  return { status: 'inconclusivo', detalhe }
}

export interface GateReparavel {
  readonly nome: string
  rodar(): Promise<VeredictoDeGate>
  // Instrucao ESTREITA, nunca recomeco: corrige exatamente o que o veredicto
  // apontou. Recomecar do zero desperdica o que ja estava certo e costuma
  // trocar um defeito por outro.
  consertoEstreito(veredicto: VeredictoDeGate, tentativa: number): Promise<string>
}

export interface Reparo {
  readonly veredicto: VeredictoDeGate
  readonly tentativas: number
  // O que foi tentado, em ordem. Sobe pro humano quando o teto estoura — sem
  // isto ele recebe "falhou" e nao sabe o que ja foi descartado.
  readonly relato: readonly string[]
}

export async function repararAteOTeto(gate: GateReparavel, teto: number, card = ''): Promise<Reparo> {
  const relato: string[] = []
  let veredicto = await gate.rodar()
  let tentativas = 0

  while (veredicto.status === 'falhou' && tentativas < teto) {
    tentativas++
    if (card) {
      anexarEvento({ card, evento: 'repair_attempt', fase: gate.nome, detalhe: `tentativa ${tentativas}/${teto}: ${veredicto.detalhe.slice(0, 200)}` })
    }
    const oQueFez = await gate.consertoEstreito(veredicto, tentativas)
    relato.push(`tentativa ${tentativas}: ${oQueFez || 'ajustou'} — motivo: ${veredicto.detalhe.slice(0, 200)}`)
    veredicto = await gate.rodar()
  }

  // 'inconclusivo' NAO dispara reparo, de proposito: nao da para consertar de
  // forma dirigida o que nao foi diagnosticado. Tentar seria adivinhacao cara.
  return { veredicto, tentativas, relato }
}

export function relatoParaHumano(r: Reparo): string {
  if (!r.relato.length) return r.veredicto.detalhe
  return `${r.veredicto.detalhe}\nja tentado (${r.tentativas}): ${r.relato.join(' | ')}`
}
