// Onda 1-A do raio-x: config/model-tier.json passa a GOVERNAR o modelo por tier
// dentro do provedor do papel — antes `registrarTier` so gravava diario e os
// quatro passos pagos rodavam todos no mesmo modelo (2 call sites, 0 leitores).
// Precedencia provada aqui: escolha do humano (ia.json) > modelosPorTier (dado
// versionado) > padrao do harness. Tier so SOBE (card e LEI elevam) — e subir
// tira o card do modelo barato, nunca o poe nele.
import { test, expect, afterAll, beforeEach } from '../apoio/runner.ts'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-tiermodelo-'))
process.env.HII_CARDS_DIR = join(BASE, 'cards')
mkdirSync(process.env.HII_CARDS_DIR, { recursive: true })

const { createCard } = await import('../../motor/cordel/store.ts')
const { acaoDoAgente, modeloGovernado, modeloDoPasso, tierDaAcaoDoCard } = await import('../../motor/oswaldo/rui.ts')
const { lerGovernanca, modeloDoTier } = await import('../../motor/euclides/tesouro/orcamento.ts')

const ENVS = ['HII_IA_FILE', 'HII_TIER_FILE', 'HII_STEP_PROVIDER', 'HII_GATE_PROVIDER', 'HII_VERIFY_PROVIDER', 'HII_AI_PROVIDER'] as const
const anteriores = new Map<string, string | undefined>(ENVS.map(n => [n, process.env[n]]))

beforeEach(() => {
  for (const n of ENVS) delete process.env[n]
  process.env.HII_IA_FILE = join(BASE, 'ia-inexistente.json')
})

afterAll(() => {
  for (const [n, v] of anteriores) {
    if (v === undefined) delete process.env[n]
    else process.env[n] = v
  }
  rmSync(BASE, { recursive: true, force: true })
})

function governancaDeTeste(extra: string): string {
  const caminho = join(BASE, `tier-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  writeFileSync(caminho, `{
    "versao": 1,
    "padrao": "tier2_padrao",
    "criterios": { "review": { "tier": "tier1_caro", "motivo": "ultima leitura antes do humano" }, "limpeza": { "tier": "tier3_barato", "motivo": "baixo risco" } },
    "orcamentoPorCard": { "tetoUsd": 16, "acaoAoEstourar": "pausar" }${extra}
  }`)
  return caminho
}

test('acaoDoAgente mapeia os seis agentes de passo e devolve vazio para desconhecido', () => {
  expect(acaoDoAgente('rufus')).toBe('arquitetura')
  expect(acaoDoAgente('testudo')).toBe('testes')
  expect(acaoDoAgente('escudo')).toBe('seguranca')
  expect(acaoDoAgente('pura')).toBe('limpeza')
  expect(acaoDoAgente('glossia')).toBe('documentacao')
  expect(acaoDoAgente('limpio')).toBe('reparo_build')
  expect(acaoDoAgente('agente-que-nao-existe')).toBe('')
})

test('a governanca do REPO mapeia so o tier3 do claude — embarque conservador, nenhum custo sobe', () => {
  const g = lerGovernanca()
  expect(modeloDoTier('claude', 'tier3_barato', g)).toBe('haiku')
  expect(modeloDoTier('claude', 'tier2_padrao', g)).toBe(undefined)
  expect(modeloDoTier('claude', 'tier1_caro', g)).toBe(undefined)
  expect(modeloDoTier('ollama', 'tier3_barato', g)).toBe(undefined)
})

test('passo de limpeza (tier3) desce para o modelo barato; passo de testes (tier2) fica no status quo', () => {
  const id = createCard({ title: 'tarefa', status: 'URL_OK', repo: 'org/repo' }, '## Objetivo\nx\n')
  expect(modeloDoPasso('pura', id)).toBe('haiku')
  expect(modeloDoPasso('testudo', id)).toBe(undefined)
  expect(modeloDoPasso('agente-desconhecido', id)).toBe(undefined)
})

test('card que ELEVA o tier tira o passo do modelo barato — pedido de tier so sobe', () => {
  const elevadoPeloCard = createCard({ title: 'a', status: 'URL_OK', repo: 'org/repo', tier: 'tier1_caro' }, '## Objetivo\na\n')
  const elevadoPelaLei = createCard({ title: 'b', status: 'URL_OK', repo: 'org/repo', lei_forcou: 'completo' }, '## Objetivo\nb\n')
  expect(tierDaAcaoDoCard('limpeza', { tier: 'tier1_caro' }).tier).toBe('tier1_caro')
  expect(tierDaAcaoDoCard('limpeza', { lei_forcou: 'completo' }).tier).toBe('tier1_caro')
  expect(modeloDoPasso('pura', elevadoPeloCard)).toBe(undefined)
  expect(modeloDoPasso('pura', elevadoPelaLei)).toBe(undefined)
})

test('a escolha explicita do humano em ia.json vence o dado de governanca', () => {
  const iaFile = join(BASE, 'ia-humano.json')
  writeFileSync(iaFile, JSON.stringify({ step: { model: 'opus' } }))
  process.env.HII_IA_FILE = iaFile
  const id = createCard({ title: 'humano', status: 'URL_OK', repo: 'org/repo' }, '## Objetivo\nh\n')
  expect(modeloDoPasso('pura', id)).toBe('opus')
})

test('acao governada em tier NAO mapeado cai no padrao do harness (gate review continua no sonnet)', () => {
  expect(modeloGovernado('gate', 'review', {})).toBe('sonnet')
})

test('tier1 mapeado no dado passa a governar o gate — editar o JSON troca o modelo, sem tocar codigo', () => {
  process.env.HII_TIER_FILE = governancaDeTeste(`,
    "modelosPorTier": { "porProvedor": { "claude": { "tier1_caro": "opus" } } }`)
  expect(modeloGovernado('gate', 'review', {})).toBe('opus')
})

test('modelosPorTier invalido LANCA: tier desconhecido e modelo vazio nao passam calados', () => {
  process.env.HII_TIER_FILE = governancaDeTeste(`,
    "modelosPorTier": { "porProvedor": { "claude": { "tier_maluco": "x" } } }`)
  expect(() => lerGovernanca()).toThrow()
  process.env.HII_TIER_FILE = governancaDeTeste(`,
    "modelosPorTier": { "porProvedor": { "claude": { "tier1_caro": "" } } }`)
  expect(() => lerGovernanca()).toThrow()
})

test('esforcoGovernado: acao tier3 cai para low pelo dado versionado, e a escolha do humano vence', async () => {
  const { esforcoGovernado } = await import('../../motor/oswaldo/rui.ts')

  expect(esforcoGovernado('step', 'limpeza', {}), 'limpeza e tier3 e o dado manda low').toBe('low')
  expect(esforcoGovernado('step', 'arquitetura', {}), 'tier1 nao tem entrada — vale o padrao do harness').toBeUndefined()
  expect(esforcoGovernado('step', 'limpeza', { effort: 'high' }), 'o humano pediu high no card; governanca nunca sobrepoe pessoa').toBe('high')
  expect(esforcoGovernado('step', '', {}), 'sem acao nao ha tier — nada a governar').toBeUndefined()
})

test('esforcoGovernado: card que ELEVA o tier tira a acao do assento barato — subir tira do low', async () => {
  const { esforcoGovernado } = await import('../../motor/oswaldo/rui.ts')

  expect(esforcoGovernado('step', 'limpeza', { tier: 'tier1_caro' }), 'tier elevado nao pode manter esforco de tier barato').toBeUndefined()
})
