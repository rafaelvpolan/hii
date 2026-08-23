import { test, expect, beforeEach, afterAll } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const criados: string[] = []

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'hicode-modelo-prov-'))
  criados.push(dir)
  process.env.HICODE_IA_FILE = join(dir, 'ia.json')
  delete process.env.HICODE_IMPLEMENT_PROVIDER
  delete process.env.HICODE_AI_PROVIDER
})

afterAll(() => {
  for (const d of criados) rmSync(d, { recursive: true, force: true })
  delete process.env.HICODE_IA_FILE
})

test('o modelo escolhido vale para o provedor em que foi escolhido', async () => {
  const { aplicar } = await import('../lib/core/escolher-ia')
  const { modelFor } = await import('../motor/tmd/registro')
  aplicar({ papeis: ['implement'], provider: 'claude', model: 'opus' })
  expect(modelFor('implement')).toBe('opus')
})

test('REGRESSAO o modelo NAO vaza para outro provedor via override de cota', async () => {
  const { aplicar } = await import('../lib/core/escolher-ia')
  const { modelFor } = await import('../motor/tmd/registro')
  aplicar({ papeis: ['implement'], provider: 'claude', model: 'opus' })
  expect(modelFor('implement', 'codex')).not.toBe('opus')
})

test('REGRESSAO trocar de provedor sem trocar o modelo nao leva o modelo antigo junto', async () => {
  const { aplicar } = await import('../lib/core/escolher-ia')
  const { modelFor, providerNameFor } = await import('../motor/tmd/registro')
  aplicar({ papeis: ['implement'], provider: 'claude', model: 'opus' })
  aplicar({ papeis: ['implement'], provider: 'kimi' })
  expect(providerNameFor('implement')).toBe('kimi')
  expect(modelFor('implement')).not.toBe('opus')
})
