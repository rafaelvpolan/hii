import { anexarEvento } from '../../euclides/eventos.ts'
import { APROVADO } from '../../ciclo/reparo.ts'
import type { VeredictoDeGate } from '../../ciclo/reparo.ts'

// Tijolo — Tijolo. Tijolo por tijolo, e o pedreiro confere o prumo antes do
// proximo.
//
// Preocupacao de QUALIDADE, nao de custo — nao confundir com ECO
// (motor/tomada/eco/prefixo.ts). O ganho aqui e nao pagar pela tarefa inteira
// para descobrir no fim que a base estava errada: quando o bloco 2 nao valida,
// os blocos 3..N nem chegam a rodar em cima de uma base quebrada.

export interface Bloco {
  readonly id: string
  // Sufixo pequeno. Nunca reescreve o prefixo ja enviado — ver ECO.
  readonly instrucao: string
  validar(): Promise<VeredictoDeGate>
}

export interface ResultadoDosBlocos {
  readonly concluido: boolean
  readonly executados: readonly string[]
  readonly pararEm: string
  readonly veredicto: VeredictoDeGate
  readonly naoExecutados: readonly string[]
}

export interface ExecucaoDeBloco {
  (bloco: Bloco, indice: number): Promise<void>
}

export async function executarEmBlocos(blocos: readonly Bloco[], executar: ExecucaoDeBloco, card = ''): Promise<ResultadoDosBlocos> {
  const executados: string[] = []

  for (let i = 0; i < blocos.length; i++) {
    const bloco = blocos[i]
    if (!bloco) continue
    if (card) anexarEvento({ card, evento: 'fase_inicio', fase: `bloco:${bloco.id}` })
    await executar(bloco, i)
    executados.push(bloco.id)
    const veredicto = await bloco.validar()
    if (card) anexarEvento({ card, evento: 'fase_fim', fase: `bloco:${bloco.id}`, detalhe: veredicto.status })

    if (veredicto.status !== 'ok') {
      // Para AQUI. Seguir gerando em cima de uma base que nao validou e o
      // desperdicio que este mecanismo existe para evitar.
      return {
        concluido: false,
        executados,
        pararEm: bloco.id,
        veredicto,
        naoExecutados: blocos.slice(i + 1).map(b => b.id),
      }
    }
  }

  return { concluido: true, executados, pararEm: '', veredicto: APROVADO, naoExecutados: [] }
}

export function relatoDosBlocos(r: ResultadoDosBlocos): string {
  if (r.concluido) return `${r.executados.length} bloco(s) concluido(s)`
  const pulados = r.naoExecutados.length ? ` — ${r.naoExecutados.length} bloco(s) nao chegaram a rodar: ${r.naoExecutados.join(', ')}` : ''
  return `parou no bloco "${r.pararEm}" (${r.veredicto.status}: ${r.veredicto.detalhe})${pulados}`
}
