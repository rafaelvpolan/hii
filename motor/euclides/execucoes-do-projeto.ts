// Registro por IA no projeto: somente metadados publicos; sem prompt ou credenciais.
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pastaDaIa, temLinkNoDestino } from '../cordel/alicerce/pastas-por-ia.ts'

export interface ExecucaoDoProjeto {
  readonly tarefa: string
  readonly provedor: string
  readonly modelo: string
  readonly papel: string
  readonly instante: string
  readonly ok: boolean
  readonly custoUsd: number | null
  readonly tokens: number
  readonly pacoteHash: string
}

export function registrarExecucaoDoProjeto(alvo: string, execucao: ExecucaoDoProjeto): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(execucao.tarefa) || !/^[a-zA-Z0-9_-]+$/.test(execucao.provedor)) throw new Error('identificador invalido para registro de execucao')
  const dir = join(pastaDaIa(alvo, execucao.provedor), 'executions')
  if (temLinkNoDestino(alvo, join(dir, execucao.tarefa + '.jsonl'))) throw new Error('registro de execucao nao pode escrever atraves de link simbolico')
  mkdirSync(dir, { recursive: true })
  appendFileSync(join(dir, execucao.tarefa + '.jsonl'), JSON.stringify({ versao: 1, ...execucao }) + '\n')
}
