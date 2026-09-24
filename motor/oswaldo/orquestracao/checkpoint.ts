import type { ImplementResult, Card } from '../../cordel/tipos.ts'
import type { Microtask, PlanoDeExecucao } from './contrato.ts'

export interface Tentativa {
  microtask: string; inicio: string; fim: string; provedor: string; modelo: string
  estado: 'executando' | 'concluida' | 'falhou' | 'interrompida'
  custo: string; custoMedido?: boolean; motivo: string
}
export interface Ramo {
  microtask: string; worktree: string; base: string; orcamentoReservadoUsd: number
  estado: 'reservado' | 'executando' | 'pronto' | 'integrando' | 'integrado' | 'bloqueado'
  tentativa: Tentativa; tentativas?: Tentativa[]; commit?: string; antesIntegrar?: string; integradoHead?: string
  fingerprint?: string; resultado?: ImplementResult; motivo?: string
}
export interface OndaParalela {
  versao: 1; tarefas: string[]; estado: 'preparando' | 'ativa' | 'concluida'
  base: string; ramos: Ramo[]
}
export interface Checkpoint {
  versao: 1; hash: string; feitas: string[]; fingerprint: string
  tentativas?: Tentativa[]; paralela?: OndaParalela; ondasConcluidas?: OndaParalela[]
}
export type Implementar = (card: Card, wt: string, feedback: string, visual: boolean) => Promise<ImplementResult>
export function pedidoDaMicrotask(card: Card, plano: PlanoDeExecucao, m: Microtask): Card {
  return { ...card, fm: { ...card.fm, title: m.titulo, orq_agente: m.agente, orq_microtask: m.id,
    ...(m.ia ? { provider_override_implement: m.ia.provedor, orq_modelo: m.ia.modelo ?? '' } : {}) },
    body: '## Objetivo\n' + plano.objetivo + '\n\nMICROTASK ATUAL (' + m.id + '):\n' + m.instrucao +
      '\nArquivos previstos: ' + (m.arquivos.join(', ') || 'inspecionar o projeto') + '\nCriterios: ' + m.criterios.join(', ') + '\n' }
}
