import { join } from 'node:path'
import { cardsDir } from '../cordel/alicerce/config.ts'
import { gravarChamadaNoLiveLog } from './harness/live-log.ts'
import type { AgentRole, HarnessId } from './tipos.ts'
import { publicarEvento } from '../euclides/ponte-eventos.ts'
import { readCard } from '../cordel/store.ts'
import { gravarDiagnostico, resumoDoDiagnostico } from './diagnostico.ts'

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
  return resumoDoDiagnostico(texto, limite)
}

export function contextoDaTrocaDeIa(t: TrocaDeIaNoLog): string {
  const de = t.de || 'provedor desconhecido'
  const detalhe = t.detalhe ? ` Detalhe tecnico: ${limpo(t.detalhe, 320)}.` : ''
  return `Esta e uma retomada da mesma tarefa e do mesmo worktree. A IA anterior (${de}) falhou por ${limpo(t.falha || 'motivo nao informado', 220)}.${detalhe} O roteador selecionou ${t.para}. Continue do estado atual, preserve o trabalho ja feito, leia o diff e o card antes de editar; nao reinicie a tarefa nem descarte alteracoes validas.`
}

export function registrarTrocaDeIaNoLiveLog(t: TrocaDeIaNoLog): void {
  const de = t.de || 'provedor desconhecido'
  const sessao = readCard(t.id)?.fm.sessao_id ?? ''
  const falha = limpo(t.falha || 'falha sem motivo resumido', 180)
  const diagnostico = gravarDiagnostico(t.id, { provedor: de, destino: t.para, papel: t.papel, falha: t.falha, detalhe: t.detalhe ?? '', motivo: t.motivo })
  publicarEvento('ia_falhou', t.id, sessao, { provedor: de, papel: t.papel, mensagem: falha, diagnostico })
  publicarEvento('ia_trocada', t.id, sessao, { de, para: t.para, papel: t.papel, mensagem: `mudando automaticamente para ${t.para}` })
  const linhas = [
    `IA ${de} falhou: ${falha}`,
    `mudando automaticamente para ${t.para}`,
    `motivo da rota: ${limpo(t.motivo, 180)}`,
    diagnostico ? `diagnostico: ${diagnostico}` : 'diagnostico indisponivel — verifique permissoes e espaco em disco',
  ].filter(Boolean)
  gravarChamadaNoLiveLog({
    caminho: join(cardsDir(), 'runs', `${t.id}.live.log`),
    rotulo: `rota ${t.papel}`,
    linhas,
  })
}
