import type { Fields } from '../../../cdl/index.ts'

export interface ExternalTask {
  externalId: string
  title: string
  body: string
}

export interface TaskSync {
  readonly name: string
  pull(): Promise<ExternalTask[]>
  // true = efeito produzido agora; false = ja constava no diario e nada foi feito.
  push(card: Fields): Promise<boolean>
}
