import * as core from './acoes.ts'
import { prepararExecucao, registrarPedido } from './execucao-da-sessao.ts'
import type { ModoDoMotor } from '../oswaldo/orquestracao/config.ts'

export function criarExecucao(repo: string, seguindo: string, titulo: string, modo: ModoDoMotor = 'gateway', extras: Record<string, string> = {}): { id: string; sessao: string } {
  const execucao = prepararExecucao(repo, seguindo, titulo, modo)
  const id = core.submit({ ...extras, title: titulo, repo, ...execucao })
  registrarPedido(execucao.sessao_id, id, execucao.motor_modo, extras.desc || titulo)
  return { id, sessao: execucao.sessao_id }
}
