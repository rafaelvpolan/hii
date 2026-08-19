import { test, expect, beforeEach } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

beforeEach(() => {
  process.env.HICODE_IA_FILE = join(mkdtempSync(join(tmpdir(), 'hii-esforco-')), 'ia.json')
  delete process.env.HICODE_EFFORT
})

async function mods(): Promise<{
  itensDeAjuste: typeof import('../lib/core/ajustes').itensDeAjuste
  ciclarAjuste: typeof import('../lib/core/ajustes').ciclarAjuste
  ESFORCO_PADRAO: string
  effortFor: typeof import('../lib/ai/registry').effortFor
}> {
  const ajustes = await import('../lib/core/ajustes')
  const registry = await import('../lib/ai/registry')
  return {
    itensDeAjuste: ajustes.itensDeAjuste,
    ciclarAjuste: ajustes.ciclarAjuste,
    ESFORCO_PADRAO: ajustes.ESFORCO_PADRAO,
    effortFor: registry.effortFor,
  }
}

async function valorDoEsforco(): Promise<string> {
  const { itensDeAjuste } = await mods()
  return itensDeAjuste().find(i => i.chave === 'implement:esforco')?.valor ?? ''
}

test('o padrao da IA e uma opcao do ciclo de esforco, nao so um rotulo de tela', async () => {
  const { itensDeAjuste, ESFORCO_PADRAO } = await mods()
  const { ESFORCOS } = await import('../lib/ai/preferencias')
  const item = itensDeAjuste().find(i => i.chave === 'implement:esforco')
  expect(item?.opcoes).toContain(ESFORCO_PADRAO)
  expect(item?.opcoes.length).toBe(ESFORCOS.length + 1)
})

test('sem preferencia gravada, o esforco aparece como padrao da IA', async () => {
  const { ESFORCO_PADRAO, effortFor } = await mods()
  expect(effortFor('implement')).toBeUndefined()
  expect(await valorDoEsforco()).toBe(ESFORCO_PADRAO)
})

test('o primeiro tab a partir do padrao vai para o primeiro nivel, sem pular o low', async () => {
  const { ciclarAjuste, effortFor } = await mods()
  const { ESFORCOS } = await import('../lib/ai/preferencias')
  const r = ciclarAjuste('implement:esforco', 1)
  expect(r.ok).toBe(true)
  expect(effortFor('implement')).toBe(ESFORCOS[0])
})

test('REGRESSAO: dando a volta no ciclo, o padrao da IA volta a ser alcancavel pela tecla', async () => {
  const { ciclarAjuste, effortFor, ESFORCO_PADRAO } = await mods()
  const { ESFORCOS } = await import('../lib/ai/preferencias')
  const vistos: string[] = [await valorDoEsforco()]
  for (let i = 0; i < ESFORCOS.length + 1; i++) {
    ciclarAjuste('implement:esforco', 1)
    vistos.push(await valorDoEsforco())
  }
  for (const nivel of ESFORCOS) expect(vistos).toContain(nivel)
  expect(vistos.filter(v => v === ESFORCO_PADRAO).length).toBe(2)
  expect(effortFor('implement')).toBeUndefined()
})

test('chegar no padrao da IA apaga a preferencia gravada, nao grava um valor falso', async () => {
  const { ciclarAjuste, effortFor, ESFORCO_PADRAO } = await mods()
  const { preferencias } = await import('../lib/ai/preferencias')
  ciclarAjuste('implement:esforco', -1)
  expect(effortFor('implement')).toBeTruthy()
  const r = ciclarAjuste('implement:esforco', 1)
  expect(effortFor('implement')).toBeUndefined()
  expect(preferencias().implement?.effort).toBeUndefined()
  expect(r.mensagem).toContain(ESFORCO_PADRAO)
})

test('shift+tab a partir do padrao desce para o ultimo nivel', async () => {
  const { ciclarAjuste, effortFor } = await mods()
  const { ESFORCOS } = await import('../lib/ai/preferencias')
  ciclarAjuste('implement:esforco', -1)
  expect(effortFor('implement')).toBe(ESFORCOS[ESFORCOS.length - 1])
})

test('o ciclo do esforco de um papel nao mexe no esforco dos outros', async () => {
  const { ciclarAjuste, effortFor } = await mods()
  ciclarAjuste('gate:esforco', 1)
  expect(effortFor('gate')).toBeTruthy()
  expect(effortFor('implement')).toBeUndefined()
})
