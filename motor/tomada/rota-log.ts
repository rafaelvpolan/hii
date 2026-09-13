import { join } from 'node:path'
import { cardsDir } from '../cordel/alicerce/config.ts'
import { gravarChamadaNoLiveLog } from './harness/live-log.ts'
import type { AgentRole, HarnessId } from './tipos.ts'

export interface TrocaDeIaNoLog {
  readonly id: string
  readonly papel: AgentRole
  readonly de: HarnessId | string | undefined
  readonly para: HarnessId
  readonly falha: string
  readonly detalhe?: string
  readonly motivo: string
}

function limpo(texto: string, limite: number): string {
  return texto.replace(/\s+/g, ' ').trim().slice(0, limite)
}

export function contextoDaTrocaDeIa(t: TrocaDeIaNoLog): string {
  const de = t.de || 'provedor desconhecido'
  const detalhe = t.detalhe ? ` Detalhe tecnico: ${limpo(t.detalhe, 320)}.` : ''
  return `Esta e uma retomada da mesma tarefa e do mesmo worktree. A IA anterior (${de}) falhou por ${limpo(t.falha || 'motivo nao informado', 220)}.${detalhe} O roteador selecionou ${t.para}. Continue do estado atual, preserve o trabalho ja feito, leia o diff e o card antes de editar; nao reinicie a tarefa nem descarte alteracoes validas.`
}

export function registrarTrocaDeIaNoLiveLog(t: TrocaDeIaNoLog): void {
  const de = t.de || 'provedor desconhecido'
  const linhas = [
    `IA ${de} falhou: ${t.falha || 'falha sem motivo resumido'}`,
    t.detalhe ? `detalhe: ${t.detalhe}` : '',
    `mudando automaticamente para ${t.para}`,
    `motivo da rota: ${t.motivo}`,
  ].filter(Boolean)
  gravarChamadaNoLiveLog({
    caminho: join(cardsDir(), 'runs', `${t.id}.live.log`),
    rotulo: `rota ${t.papel}`,
    linhas,
  })
}
