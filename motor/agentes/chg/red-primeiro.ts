import { anexarEvento, eventosDoCard } from '../../euc/eventos.ts'
import type { StepProfile } from '../../osw/rta/perfil.ts'

// CHG — Carlos Chagas: descreveu vetor, parasita e doenca. Prova de ciclo
// completo, nao "um teste qualquer que passa".
//
// Item 5: no perfil `completo`, o teste tem de ter FALHADO antes de passar. Um
// teste escrito depois do codigo, que ja nasce verde, nao prova que cobre o
// caminho — prova so que compila. A evidencia do RED fica no diario do card,
// nao no relato do modelo: "o modelo disse que fez TDD" e exatamente o tipo de
// autorrelato que nenhum gate deste motor aceita.

export const FASE_RED = 'red'

// Registrado por quem roda o teste quando ele reprova ANTES do reparo: essa e
// a unica evidencia de RED que o motor consegue produzir sozinho, sem confiar
// no que o modelo diz ter feito.
export function registrarRed(card: string, detalhe: string): void {
  anexarEvento({ card, evento: 'gate_verdict', fase: FASE_RED, detalhe })
}

export interface EvidenciaDeRed {
  readonly temRed: boolean
  readonly quando: string
  readonly detalhe: string
}

// Registrado por quem roda o teste, quando ele reprova ANTES da implementacao.
export function evidenciaDeRed(card: string): EvidenciaDeRed {
  const red = eventosDoCard(card).find(e => e.evento === 'gate_verdict' && e.fase === FASE_RED)
  return { temRed: !!red, quando: red?.ts ?? '', detalhe: red?.detalhe ?? '' }
}

export interface ExigenciaDeRed {
  readonly exigido: boolean
  readonly satisfeito: boolean
  readonly motivo: string
}

// So o perfil `completo` exige. Nos outros o custo de forcar RED nao paga: um
// ajuste de texto nao tem caminho de erro para provar primeiro.
export function exigirRedAntesDoGreen(card: string, perfil: StepProfile): ExigenciaDeRed {
  if (perfil !== 'completo') {
    return { exigido: false, satisfeito: true, motivo: `perfil "${perfil}" nao exige RED antes do GREEN` }
  }
  const ev = evidenciaDeRed(card)
  if (ev.temRed) {
    return { exigido: true, satisfeito: true, motivo: `RED registrado em ${ev.quando}: ${ev.detalhe}` }
  }
  return {
    exigido: true,
    satisfeito: false,
    motivo: 'perfil completo exige teste que FALHOU antes de passar, e o diario do card nao tem evento de RED — teste escrito depois do codigo nao prova cobertura',
  }
}
