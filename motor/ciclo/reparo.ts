import { anexarEvento } from '../euclides/eventos.ts'

// Ciclo — o repair loop generico. Uma tentativa DIRIGIDA por vez, com teto, e
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

// Assinatura de um veredicto, para comparar VOLTAS entre si.
//
// O teto de tentativas e cego: ele conta quantas voltas foram dadas, nunca se
// alguma andou. Um agente que devolve a mesma coisa tres vezes paga tres vezes e
// para no teto, e o diario diz "esgotou tentativas" como se tivesse havido
// progresso. Comparar a reprovacao ANTERIOR com a atual custa uma normalizacao e
// responde a pergunta que o teto nao faz: mudou alguma coisa?
//
// A normalizacao e proposital e minima — caixa e espaco em branco. Mexer mais
// (tirar numero, tirar caminho) faria reprovacoes DIFERENTES colapsarem na mesma
// assinatura, e parar cedo por engano custa mais caro que uma volta a mais.
export function assinaturaDeVeredicto(texto: string): string {
  return String(texto || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

export interface Reparo {
  readonly veredicto: VeredictoDeGate
  readonly tentativas: number
  // Verdadeiro quando o laco parou por REPETICAO, e nao por teto: o gate devolveu
  // a mesma reprovacao duas vezes seguidas. Quem le o relato precisa distinguir
  // "tentou de tudo" de "tentou a mesma coisa de novo".
  readonly semProgresso: boolean
  // O que foi tentado, em ordem. Sobe pro humano quando o teto estoura — sem
  // isto ele recebe "falhou" e nao sabe o que ja foi descartado.
  readonly relato: readonly string[]
}

export async function repararAteOTeto(gate: GateReparavel, teto: number, card = ''): Promise<Reparo> {
  const relato: string[] = []
  let veredicto = await gate.rodar()
  let tentativas = 0
  let semProgresso = false

  while (veredicto.status === 'falhou' && tentativas < teto) {
    tentativas++
    if (card) {
      anexarEvento({ card, evento: 'repair_attempt', fase: gate.nome, detalhe: `tentativa ${tentativas}/${teto}: ${veredicto.detalhe.slice(0, 200)}` })
    }
    const antes = assinaturaDeVeredicto(veredicto.detalhe)
    const oQueFez = await gate.consertoEstreito(veredicto, tentativas)
    relato.push(`tentativa ${tentativas}: ${oQueFez || 'ajustou'} — motivo: ${veredicto.detalhe.slice(0, 200)}`)
    veredicto = await gate.rodar()
    // Mesma reprovacao, palavra por palavra, depois de um conserto dirigido: o
    // conserto nao pegou. Continuar ate o teto paga as voltas restantes para
    // receber esta mesma frase de novo.
    if (veredicto.status === 'falhou' && assinaturaDeVeredicto(veredicto.detalhe) === antes) {
      semProgresso = true
      relato.push(`parou na tentativa ${tentativas}: o gate repetiu a MESMA reprovacao — o conserto nao mudou o veredicto`)
      if (card) {
        anexarEvento({ card, evento: 'repair_attempt', fase: gate.nome, detalhe: `sem progresso na tentativa ${tentativas}: veredicto identico ao anterior — parando antes do teto de ${teto}` })
      }
      break
    }
  }

  // 'inconclusivo' NAO dispara reparo, de proposito: nao da para consertar de
  // forma dirigida o que nao foi diagnosticado. Tentar seria adivinhacao cara.
  return { veredicto, tentativas, relato, semProgresso }
}

export function relatoParaHumano(r: Reparo): string {
  if (!r.relato.length) return r.veredicto.detalhe
  return `${r.veredicto.detalhe}\nja tentado (${r.tentativas}): ${r.relato.join(' | ')}`
}
