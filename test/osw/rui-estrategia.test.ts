import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-rui-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(join(process.env.HICODE_CARDS_DIR, 'runs'), { recursive: true })
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const { tierDoCard, registrarTier } = await import('../../motor/osw/rui.ts')
const { eventosDoCard } = await import('../../motor/euc/eventos.ts')

test('sem pedido nenhum, vale o tier declarado no catalogo para a acao', () => {
  const e = tierDoCard('documentacao', {})
  expect(e.tier).toBe('tier3_barato')
  expect(e.motivo).toContain('baixo risco')
})

test('REGRA DE SUBIDA o card pode pedir tier mais caro e ganha', () => {
  const e = tierDoCard('documentacao', { pedidoDoCard: 'tier1_caro' })
  expect(e.tier).toBe('tier1_caro')
  expect(e.motivo).toContain('card')
})

test('REGRA DE SUBIDA o card pede tier mais barato e e IGNORADO', () => {
  const e = tierDoCard('seguranca', { pedidoDoCard: 'tier3_barato' })
  expect(e.tier, 'baixar o rigor pelo card e o mesmo vetor de bypass que a LEI fecha').toBe('tier1_caro')
})

test('tier invalido no card nao vira tier barato calado — fica o do catalogo, e o motivo diz', () => {
  const e = tierDoCard('implementacao', { pedidoDoCard: 'tier_de_mentira' })
  expect(e.tier).toBe('tier2_padrao')
  expect(e.motivo).toContain('tier_de_mentira')
})

test('todo passo de config/pipeline.json tem tier declarado — passo novo nao roda sem governanca', async () => {
  const { activeSteps } = await import('../../motor/nmy/config.ts')
  const { lerGovernanca } = await import('../../motor/euc/tsr/orcamento.ts')
  const g = lerGovernanca()
  for (const passo of activeSteps()) {
    expect(g.criterios[passo.id], `passo "${passo.id}" do pipeline sem tier em model-tier.json`).toBeDefined()
  }
})

test('LEI que elevou o rigor eleva o tier junto, mesmo em acao barata', () => {
  const e = tierDoCard('limpeza', { leiForcou: true })
  expect(e.tier).toBe('tier1_caro')
  expect(e.motivo).toContain('LEI')
})

test('LEI e card pedindo coisas diferentes: vale o mais caro dos dois', () => {
  const e = tierDoCard('documentacao', { leiForcou: true, pedidoDoCard: 'tier2_padrao' })
  expect(e.tier).toBe('tier1_caro')
})

test('a escolha vai para o diario com o motivo — custo sem porque nao e auditavel', () => {
  const e = tierDoCard('seguranca', {})
  registrarTier('rui-1', 'seguranca', e)
  const ev = eventosDoCard('rui-1').filter(x => x.evento === 'model_tier_selected')
  expect(ev.length).toBe(1)
  expect(ev[0]?.chave).toBe('seguranca')
  expect(ev[0]?.resultado).toBe('tier1_caro')
  expect(ev[0]?.detalhe, 'o motivo e o que torna a escolha discutivel depois').toContain('falso negativo')
})
