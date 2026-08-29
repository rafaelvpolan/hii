import { GithubIssuesSync } from './github-issues.ts'
import type { TaskSync } from './tipos.ts'

const SYNCS: Record<string, TaskSync> = {
  'github-issues': new GithubIssuesSync(),
}

export function taskSyncName(): string {
  return process.env.HICODE_TASK_SYNC || 'none'
}

export function taskSync(): TaskSync | null {
  return SYNCS[taskSyncName()] ?? null
}

// `taskSyncNames()` era lista calculada sem consumidor de producao. Passou a ser
// a fonte da VALIDACAO: HICODE_TASK_SYNC com erro de digitacao caia em `null`, o
// motor tratava como "nenhum sync configurado" e o CLI imprimia "0 cards criados,
// 0 espelhados" com exit 0 — o operador pediu espelhamento e nao recebeu nada,
// sem uma linha dizendo por que.
export function taskSyncInvalido(): string {
  const nome = taskSyncName()
  if (nome === 'none' || SYNCS[nome]) return ''
  return `HICODE_TASK_SYNC="${nome}" nao e um sync conhecido — validos: ${taskSyncNames().join(' · ')}. Nenhuma tarefa externa sera espelhada.`
}

export function taskSyncNames(): string[] {
  return ['none', ...Object.keys(SYNCS)]
}
