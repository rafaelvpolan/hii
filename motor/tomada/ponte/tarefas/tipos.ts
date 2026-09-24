import type { Fields } from '../../../cordel/index.ts'

export interface ExternalTask {
  source?: string
  repo?: string
  externalId: string
  title: string
  body: string
  estado?: 'open' | 'closed'
  bloqueios?: string[]
  prioridade?: string
}

export interface TaskSync {
  readonly name: string
  pull(): Promise<ExternalTask[]>
  // true = efeito produzido agora; false = ja constava no diario e nada foi feito.
  push(card: Fields): Promise<boolean>
}
