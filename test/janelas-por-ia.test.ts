import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let estado = ''
let claudeJson = ''

const AGORA = Date.parse('2026-08-19T18:00:00Z')

beforeEach(() => {
  estado = mkdtempSync(join(tmpdir(), 'hii-janelas-'))
  mkdirSync(join(estado, 'runs'), { recursive: true })
  process.env.HICODE_CARDS_DIR = estado
  process.env.HICODE_COTA_TTL_MS = '0'
  claudeJson = join(estado, 'claude.json')
  process.env.HICODE_CLAUDE_CONFIG = claudeJson
})

afterEach(() => {
  delete process.env.HICODE_JANELAS_CLAUDE
  delete process.env.HICODE_JANELAS_CODEX
  delete process.env.HICODE_CLAUDE_CONFIG
  delete process.env.HICODE_COTA_TTL_MS
})

function claudeReporta(utilization: Record<string, { utilization: number; resets_at?: string }>, medidoEmMs = AGORA): void {
  writeFileSync(claudeJson, JSON.stringify({
    oauthAccount: { userRateLimitTier: 'default_claude_max_5x' },
    cachedUsageUtilization: { fetchedAtMs: medidoEmMs, utilization },
  }))
}

function run(card: string, quandoMs: number, custo: string, provedor = 'claude'): void {
  const carimbo = new Date(quandoMs).toISOString().replace(/[^0-9]/g, '').slice(0, 14)
  writeFileSync(join(estado, 'runs', `${card}-${carimbo}.json`), JSON.stringify({
    id: card, ts: new Date(quandoMs).toISOString(), ok: true, cost_usd: custo,
    duration_s: 10, tokens_total: 1000, provider: provedor, model: 'opus-5',
  }))
}

test('a duracao vem do rotulo, em hora, dia ou minuto', async () => {
  const { duracaoDaJanela } = await import('../motor/euc/tsr/janelas')
  expect(duracaoDaJanela('5h')).toBe(5 * 3600_000)
  expect(duracaoDaJanela('4h')).toBe(4 * 3600_000)
  expect(duracaoDaJanela('7d')).toBe(7 * 24 * 3600_000)
  expect(duracaoDaJanela('30m')).toBe(30 * 60_000)
  expect(duracaoDaJanela('lixo')).toBe(0)
})

test('cada ia tem suas janelas, e a env manda quando quero 4h em vez de 5h', async () => {
  const { rotulosDoProvedor } = await import('../motor/euc/tsr/janelas')
  expect(rotulosDoProvedor('claude')).toEqual(['5h', '7d'])
  expect(rotulosDoProvedor('ollama')).toEqual([])
  process.env.HICODE_JANELAS_CODEX = '4h, 7d'
  expect(rotulosDoProvedor('codex')).toEqual(['4h', '7d'])
  process.env.HICODE_JANELAS_CODEX = 'lixo'
  expect(rotulosDoProvedor('codex')).toEqual(['5h', '7d'])
})

test('ALINHAMENTO: a janela segue o reset do provedor, nao o relogio de agora', async () => {
  const resetaEm = '2026-08-21T23:00:00Z'
  claudeReporta({ seven_day: { utilization: 69, resets_at: resetaEm } })
  const { janelasDoProvedor } = await import('../motor/euc/tsr/janelas')
  const semana = janelasDoProvedor('claude', AGORA).find(j => j.rotulo === '7d')
  expect(semana?.fimMs).toBe(Date.parse(resetaEm))
  expect(semana?.inicioMs).toBe(Date.parse(resetaEm) - 7 * 24 * 3600_000)
  expect(semana?.percentualDoLimite).toBe(69)
  expect(semana?.restamMs).toBe(Date.parse(resetaEm) - AGORA)
})

test('sem reset reportado, a janela e corrida a partir de agora', async () => {
  claudeReporta({})
  const { janelasDoProvedor } = await import('../motor/euc/tsr/janelas')
  const cinco = janelasDoProvedor('claude', AGORA).find(j => j.rotulo === '5h')
  expect(cinco?.fimMs).toBe(AGORA)
  expect(cinco?.inicioMs).toBe(AGORA - 5 * 3600_000)
  expect(cinco?.percentualDoLimite).toBeNull()
})

test('LEITURA VELHA: medicao mais antiga que a janela nao pode passar por limite atual', async () => {
  claudeReporta(
    { five_hour: { utilization: 0 }, seven_day: { utilization: 69 } },
    AGORA - 6 * 3600_000,
  )
  const { janelasDoProvedor } = await import('../motor/euc/tsr/janelas')
  const janelas = janelasDoProvedor('claude', AGORA)
  expect(janelas.find(j => j.rotulo === '5h')?.limiteConfiavel).toBe(false)
  expect(janelas.find(j => j.rotulo === '7d')?.limiteConfiavel).toBe(true)
})

test('provedor que nao reporta nada fica sem percentual, e nao inventa zero', async () => {
  const { janelasDoProvedor } = await import('../motor/euc/tsr/janelas')
  const janelas = janelasDoProvedor('codex', AGORA)
  expect(janelas.length).toBe(2)
  expect(janelas.every(j => j.percentualDoLimite === null)).toBe(true)
  expect(janelas.every(j => j.limiteConfiavel === false)).toBe(true)
})

test('ia local nao tem janela de limite nenhuma', async () => {
  const { janelasDoProvedor } = await import('../motor/euc/tsr/janelas')
  expect(janelasDoProvedor('ollama', AGORA)).toEqual([])
})

test('o gasto do motor e contado DENTRO da janela do provedor, e o de fora fica fora', async () => {
  const resetaEm = '2026-08-21T23:00:00Z'
  const fim = Date.parse(resetaEm)
  const inicio = fim - 7 * 24 * 3600_000
  run('010', inicio + 3600_000, '0.10')
  run('011', inicio - 3600_000, '0.99')
  const { gastoDoMotorNoIntervalo } = await import('../motor/euc/tsr/consumo')
  const dentro = gastoDoMotorNoIntervalo('claude', inicio, fim)
  expect(dentro.custoUsd).toBe(0.1)
  expect(dentro.runs).toBe(1)
})

test('o gasto do motor e por provedor: o que foi do codex nao entra no claude', async () => {
  run('010', AGORA - 3600_000, '0.10', 'claude')
  run('011', AGORA - 3600_000, '0.02', 'codex')
  const { gastoDoMotorNoIntervalo } = await import('../motor/euc/tsr/consumo')
  expect(gastoDoMotorNoIntervalo('claude', AGORA - 5 * 3600_000, AGORA).custoUsd).toBe(0.1)
  expect(gastoDoMotorNoIntervalo('codex', AGORA - 5 * 3600_000, AGORA).custoUsd).toBe(0.02)
})

test('a tela separa o limite do provedor do gasto do motor, sem misturar os dois', async () => {
  const { renderConfig } = await import('../motor/mir/render/config')
  const { stripAnsi } = await import('../motor/mir/tui/layout')
  const base = {
    provedores: [{
      nome: 'claude', situacao: 'disponivel' as const, habilitado: true, motivo: '',
      plano: 'Max 5x', planoLido: true, rodaLocal: false, detalheDoPlano: '', idadeDoUsoHoras: 0.2, modelosDisponiveis: [],
      papeis: [], modelo: '', esforco: '', restringeFerramenta: true, isolaLeitura: true, reportaCusto: true,
      janelas: [
        { rotulo: '5h', percentualDoLimite: 12, limiteConfiavel: true, gastoDoMotorUsd: 0.85, runsDoMotor: 1, restamMs: 3600_000 },
        { rotulo: '7d', percentualDoLimite: null, limiteConfiavel: false, gastoDoMotorUsd: 0, runsDoMotor: 0, restamMs: 0 },
      ],
    }],
    selecionado: 'claude', uso5h: [], usoSemana: [], serie: [], loop: [], fila: 0,
    gastoHoje: 0, tetoUsd: 0, projeto: 'org/app', sessao: { curto: '', papeis: [], custoUsd: 0, tokens: 0 },
  }
  const t = renderConfig(base, { color: false, largura: 104, altura: 40 }).map(stripAnsi).join('\n')
  expect(t).toContain('12%')
  expect(t).toContain('motor US$0.85 · 1 run')
  expect(t).toContain('limite nao reportado')
  expect(t).toContain('motor nao rodou aqui')
  expect(t).toContain('GASTO DO MOTOR')
})

test('REGRESSAO classificacao saiu dos papeis configuraveis junto com a leitura de intencao', async () => {
  const { agentRoles } = await import('../motor/tmd/registro')
  expect(agentRoles()).not.toContain('classificacao')
  expect(agentRoles()).toEqual(['implement', 'verify', 'gate', 'step'])
})

