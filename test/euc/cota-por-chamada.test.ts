import { test, expect, beforeEach, afterAll } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { IaDaSessao, PapelDeChamada } from '../../motor/cdl/tipos'

process.env.HICODE_COTA_TTL_MS = '0'

const criados: string[] = []
let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hii-cota-chamada-'))
  criados.push(dir)
  process.env.HICODE_CARDS_DIR = dir
  mkdirSync(join(dir, 'runs'), { recursive: true })
})

afterAll(() => {
  for (const d of criados) rmSync(d, { recursive: true, force: true })
})

function carimbo(ms: number): string {
  return new Date(ms).toISOString().replace(/[^0-9]/g, '').slice(0, 14)
}

function ia(over: Partial<IaDaSessao> = {}): IaDaSessao {
  return {
    papel: 'implement' as PapelDeChamada,
    rotulo: 'executa',
    provedor: 'claude',
    modelo: 'opus-5',
    custoUsd: 0.1,
    custoMedido: true,
    tokens: 1000,
    tokensEntrada: 200,
    tokensSaida: 300,
    tokensCache: 500,
    duracaoS: 10,
    chamadas: 1,
    falhas: 0,
    ...over,
  }
}

interface RunEmDisco {
  id: string
  ok?: boolean
  cost_usd?: string
  provider?: string
  model?: string
  tokens_total?: number
  tokensEntrada?: number
  failure_class?: string
  session?: string
  kind?: 'execucao' | 'conversa'
  ias?: IaDaSessao[]
}

function run(over: RunEmDisco, hasMs = 60_000): string {
  const quando = Date.now() - hasMs
  const nome = over.kind === 'conversa'
    ? `conversa-${carimbo(quando)}-4242.json`
    : `${over.id}-${carimbo(quando)}.json`
  writeFileSync(join(dir, 'runs', nome), JSON.stringify({
    ts: new Date(quando).toISOString(),
    ok: true,
    cost_usd: '0.12',
    duration_s: 30,
    tokens_total: 1000,
    provider: 'claude',
    model: 'opus-5',
    ...over,
  }))
  return nome
}

test('ATRIBUICAO POR CHAMADA: o gate em codex deixa de ser cobrado do claude', async () => {
  run({
    id: '011', cost_usd: '0.12', provider: 'claude', tokens_total: 1500, session: '011-x',
    ias: [
      ia({ provedor: 'claude', custoUsd: 0.1, tokens: 1000 }),
      ia({ papel: 'gate', rotulo: 'revisa', provedor: 'codex', modelo: 'gpt-5', custoUsd: 0.02, tokens: 500 }),
    ],
  })
  const { lerCota } = await import('../../motor/euc/tsr/cota')
  const cota = lerCota()
  const claude = cota.provedores.find(p => p.provedor === 'claude')
  const codex = cota.provedores.find(p => p.provedor === 'codex')
  expect(claude?.custoUsd).toBe(0.1)
  expect(codex?.custoUsd).toBe(0.02)
  expect(claude?.porChamada).toBe(true)
  expect(cota.custoUsd).toBe(0.12)
})

test('COMPATIBILIDADE: execucao antiga sem ledger continua toda no provedor do topo', async () => {
  run({ id: '010', cost_usd: '0.30', provider: 'claude', tokens_total: 900 })
  const { lerCota } = await import('../../motor/euc/tsr/cota')
  const claude = lerCota().provedores.find(p => p.provedor === 'claude')
  expect(claude?.custoUsd).toBe(0.3)
  expect(claude?.porChamada).toBe(false)
})

test('uma execucao com duas IAs conta como participacao para cada provedor', async () => {
  run({
    id: '011', session: '011-x',
    ias: [ia({ provedor: 'claude' }), ia({ papel: 'gate', provedor: 'codex', custoUsd: 0.01 })],
  })
  const { lerCota } = await import('../../motor/euc/tsr/cota')
  const cota = lerCota()
  expect(cota.provedores.find(p => p.provedor === 'claude')?.runs).toBe(1)
  expect(cota.provedores.find(p => p.provedor === 'codex')?.runs).toBe(1)
  expect(cota.runs).toBe(1)
})

test('falha da execucao nao mancha o provedor que apenas participou', async () => {
  run({
    id: '011', ok: false, provider: 'claude', session: '011-x',
    ias: [
      ia({ provedor: 'claude', falhas: 1 }),
      ia({ papel: 'gate', provedor: 'codex', custoUsd: 0.01, falhas: 0 }),
    ],
  })
  const { lerCota } = await import('../../motor/euc/tsr/cota')
  const cota = lerCota()
  expect(cota.provedores.find(p => p.provedor === 'claude')?.runsComFalha).toBe(1)
  expect(cota.provedores.find(p => p.provedor === 'codex')?.runsComFalha).toBe(0)
})

test('limite de cota fica no provedor que bateu nele, nao em quem participou', async () => {
  run({
    id: '011', ok: false, provider: 'claude', failure_class: 'quota', session: '011-x',
    ias: [ia({ provedor: 'claude' }), ia({ papel: 'gate', provedor: 'codex', custoUsd: 0.01 })],
  })
  const { lerCota } = await import('../../motor/euc/tsr/cota')
  const cota = lerCota()
  expect(cota.provedores.find(p => p.provedor === 'claude')?.limiteAtingido).toBe(true)
  expect(cota.provedores.find(p => p.provedor === 'codex')?.limiteAtingido).toBe(false)
  expect(cota.limiteAtingido).toBe(true)
})

test('o split de tokens vem do ledger, nao vira tudo "nao separado"', async () => {
  run({
    id: '011', session: '011-x',
    ias: [ia({ provedor: 'claude', tokens: 1000, tokensEntrada: 200, tokensSaida: 300, tokensCache: 500 })],
  })
  const { consumoPorProvedor, JANELA_5H } = await import('../../motor/euc/tsr/consumo')
  const claude = consumoPorProvedor(JANELA_5H).find(c => c.provedor === 'claude')
  expect(claude?.tokensEntrada).toBe(200)
  expect(claude?.tokensSaida).toBe(300)
  expect(claude?.tokensCache).toBe(500)
  expect(claude?.tokensNaoSeparados).toBe(0)
})

test('A CONVERSA ENTRA NO CONSUMO: gasto de pergunta deixa de ser orfao', async () => {
  run({
    id: '', kind: 'conversa', provider: '', cost_usd: '0.0042', session: 'conversa-x',
    ias: [
      ia({ papel: 'conversa', rotulo: 'conversa', provedor: 'claude', modelo: 'haiku', custoUsd: 0.004, tokens: 800, tokensEntrada: 300, tokensSaida: 500, tokensCache: 0 }),
      ia({ papel: 'classificacao', rotulo: 'leitura', provedor: 'ollama', modelo: 'q3', custoUsd: 0, tokens: 100, tokensEntrada: 40, tokensSaida: 60, tokensCache: 0 }),
    ],
  })
  const { consumoPorProvedor, JANELA_5H } = await import('../../motor/euc/tsr/consumo')
  const consumo = consumoPorProvedor(JANELA_5H)
  expect(consumo.find(c => c.provedor === 'claude')?.custoUsd).toBe(0.004)
  expect(consumo.find(c => c.provedor === 'ollama')?.tokens).toBe(100)
  const { lerCota } = await import('../../motor/euc/tsr/cota')
  expect(lerCota().custoUsd).toBe(0.004)
})

test('a conversa aparece no historico como chat, sem tarefa', async () => {
  run({ id: '', kind: 'conversa', provider: '', cost_usd: '0.004', session: 'conversa-x', ias: [ia({ papel: 'conversa', rotulo: 'conversa' })] })
  const { historicoDeSessoes } = await import('../../motor/mir/historico')
  const { renderHistorico } = await import('../../motor/mir/render/historico')
  const { stripAnsi } = await import('../../motor/mir/tui/layout')
  const h = historicoDeSessoes()
  expect(h.sessoes.length).toBe(1)
  expect(h.sessoes[0]?.tipo).toBe('conversa')
  const texto = renderHistorico(h, { color: false }).map(stripAnsi).join('\n')
  expect(texto).toContain('chat')
})

test('o registro da conversa e reescrito, nao duplicado, a cada chamada', async () => {
  const m = await import('../../motor/euc/ias-da-sessao')
  const { atualizarRegistroDeConversa } = await import('../../motor/euc/registros')
  const sessao = `conversa-${carimbo(Date.now())}-4242`
  const chamada = (custo: number): void => m.registrarChamada(sessao, {
    ts: new Date().toISOString(), papel: 'conversa', provedor: 'claude', modelo: 'haiku',
    custoUsd: custo, custoMedido: true, tokens: 100, tokensEntrada: 40, tokensSaida: 60,
    tokensCache: 0, duracaoS: 2, ok: true,
  })
  chamada(0.001)
  atualizarRegistroDeConversa(sessao)
  chamada(0.002)
  const rec = atualizarRegistroDeConversa(sessao)
  const arquivos = readdirSync(join(dir, 'runs')).filter(f => f.endsWith('.json'))
  expect(arquivos.length).toBe(1)
  expect(rec?.cost_usd).toBe('0.0030')
  expect(rec?.kind).toBe('conversa')
  expect(rec?.ias?.[0]?.chamadas).toBe(2)
})

test('sem chamada nenhuma, nao inventa registro de conversa', async () => {
  const { atualizarRegistroDeConversa } = await import('../../motor/euc/registros')
  expect(atualizarRegistroDeConversa('conversa-20260819120000-1')).toBeNull()
  expect(readdirSync(join(dir, 'runs')).length).toBe(0)
})
