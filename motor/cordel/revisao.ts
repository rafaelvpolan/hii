import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'

export class RevisaoAlterada extends Error {}
const revisao = new AsyncLocalStorage<{ id: string; etag: string; conferida: boolean }>()

export function etagDe(valor: object): string {
  return `"${createHash('sha256').update(JSON.stringify(valor)).digest('hex')}"`
}

export function comRevisao<T>(id: string, etag: string, executar: () => T): T {
  return revisao.run({ id, etag, conferida: false }, executar)
}

export function conferirRevisao(id: string, atual: object): void {
  const esperada = revisao.getStore()
  if (!esperada || esperada.id !== id || esperada.conferida) return
  if (esperada.etag !== etagDe(atual)) throw new RevisaoAlterada('recurso mudou')
  esperada.conferida = true
}
