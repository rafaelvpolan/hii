import { allCards } from '../cordel/store.ts'
import { observarEstado } from './registro.ts'
import type { Escopo } from './contrato.ts'

/** Apenas reconstroi telemetria das transicoes duraveis. Nao acorda a fila. */
export function reconciliar(filtro: Partial<Escopo>): void {
  try {
    for (const fm of allCards()) if (fm.id && (!filtro.repo || fm.repo === filtro.repo) && (!filtro.sessao || fm.sessao_id === filtro.sessao) && (!filtro.execucao || fm.id === filtro.execucao)) observarEstado(fm.id, fm)
  } catch { /* snapshot sinaliza indisponibilidade sem executar trabalho */ }
}
