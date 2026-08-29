// Voto — Voto. Seleciona uma alternativa entre varias, e diz o placar.
//
// Duas recusas deliberadas, pelas quais existem testes: votacao vazia LANCA em
// vez de aprovar por omissao, e EMPATE nao escolhe ninguem. Desempatar sozinho
// — pelo primeiro da lista, pela ordem alfabetica — seria fabricar veredicto
// onde os criticos nao produziram um, que e a forma silenciosa de o gate mentir.

export interface Voto {
  readonly lente: string
  readonly escolha: string
  readonly porque: string
}

export interface Apuracao {
  readonly vencedor: string
  readonly votos: number
  readonly total: number
  readonly unanime: boolean
  readonly empate: boolean
}

export function contar(votos: readonly Voto[]): ReadonlyMap<string, number> {
  const placar = new Map<string, number>()
  for (const v of votos) placar.set(v.escolha, (placar.get(v.escolha) ?? 0) + 1)
  return placar
}

function exigirEscolhaNomeada(votos: readonly Voto[]): void {
  for (const v of votos) {
    if (!v.escolha.trim()) throw new Error(`lente "${v.lente}" votou em escolha vazia — string vazia e o sinal de empate, nao um candidato`)
  }
}

function exigirLenteUnica(votos: readonly Voto[]): void {
  const vistas = new Set<string>()
  for (const v of votos) {
    if (vistas.has(v.lente)) throw new Error(`lente "${v.lente}" votou duas vezes — o mesmo critico contado em dobro falseia o placar`)
    vistas.add(v.lente)
  }
}

export function apurar(votos: readonly Voto[]): Apuracao {
  if (!votos.length) throw new Error('apuracao sem voto nenhum — votacao vazia nao produz veredicto')
  exigirEscolhaNomeada(votos)
  exigirLenteUnica(votos)
  const placar = contar(votos)
  const maior = Math.max(...placar.values())
  const lideres = [...placar.entries()].filter(([, n]) => n === maior).map(([escolha]) => escolha)
  const empate = lideres.length > 1
  return {
    vencedor: empate ? '' : (lideres[0] ?? ''),
    votos: maior,
    total: votos.length,
    unanime: !empate && maior === votos.length,
    empate,
  }
}
