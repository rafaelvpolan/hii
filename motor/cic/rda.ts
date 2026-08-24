import { apurar, contar } from './vto.ts'
import type { Voto } from './vto.ts'

// RDA — Roda. Mede se os criticos convergiram, e nomeia quem ficou fora.
//
// Distinto do VTO de proposito: o voto diz QUEM ganhou, a roda diz SE houve
// acordo. Maioria de 2 a 1 elege um vencedor e ao mesmo tempo revela que um
// terco dos criticos viu outra coisa — tratar isso como "decidido" perde
// exatamente o sinal que justifica ouvir varias lentes.

export const CONSENSO_MINIMO = 2 / 3

export interface Consenso {
  readonly houve: boolean
  readonly nivel: number
  readonly escolha: string
  readonly divergentes: readonly string[]
}

export function consenso(votos: readonly Voto[], minimo: number = CONSENSO_MINIMO): Consenso {
  const a = apurar(votos)
  const nivel = a.votos / a.total
  const escolha = a.empate ? '' : a.vencedor
  const divergentes = votos.filter(v => v.escolha !== escolha).map(v => v.lente)
  return { houve: !a.empate && nivel >= minimo, nivel, escolha, divergentes }
}

export function placar(votos: readonly Voto[]): ReadonlyMap<string, number> {
  return contar(votos)
}
