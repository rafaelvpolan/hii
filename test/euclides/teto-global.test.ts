// Onda 1-C do raio-x: HICODE_BUDGET_USD passa a valer de verdade. OPERACAO.md
// prometia um teto global que NENHUMA linha lia (snapshot.ts registrou isso em
// comentario; valor-aplicado.test.ts provou o painel mostrando 0 com o motor
// barrando em 16). Agora: janela movel somando TODOS os provedores, barra no
// DESPACHO (job em voo termina, nenhum status muda), destrava sozinho quando o
// run mais antigo sai da janela, e governanca ilegivel e fail-open COM aviso.
import { test, expect, beforeEach, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-tetoglobal-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
const RUNS = join(BASE, 'cards', 'runs')
mkdirSync(RUNS, { recursive: true })

const { lerTetoGlobal, despachoLiberado } = await import('../../motor/euclides/tesouro/teto-global.ts')
const { esquecerLoteEmCache } = await import('../../motor/euclides/tesouro/cota-runs.ts')
const { lerSaudeDoMotor } = await import('../../motor/euclides/radar/saude.ts')

const AGORA = Date.parse('2026-09-04T12:00:00Z')
const HORA = 3_600_000

const anteriores = new Map<string, string | undefined>([
  ['HICODE_BUDGET_USD', process.env.HICODE_BUDGET_USD],
  ['HICODE_TIER_FILE', process.env.HICODE_TIER_FILE],
])

beforeEach(() => {
  delete process.env.HICODE_BUDGET_USD
  delete process.env.HICODE_TIER_FILE
  esquecerLoteEmCache()
})

afterAll(() => {
  for (const [n, v] of anteriores) {
    if (v === undefined) delete process.env[n]
    else process.env[n] = v
  }
  rmSync(BASE, { recursive: true, force: true })
})

let seqRun = 0

interface RunDeTeste {
  custo: number
  provedor: string
  haMs: number
  ias?: Array<{ provedor: string; custoUsd: number; custoMedido: boolean; tokens: number; chamadas: number }>
}

function escreverRun(r: RunDeTeste): void {
  const quandoMs = AGORA - r.haMs
  const compacto = new Date(quandoMs).toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const nome = `${String(++seqRun).padStart(3, '0')}-${compacto}.json`
  writeFileSync(join(RUNS, nome), JSON.stringify({
    id: String(seqRun).padStart(3, '0'),
    ts: new Date(quandoMs).toISOString(),
    ok: true,
    cost_usd: String(r.custo),
    provider: r.provedor,
    kind: 'execucao',
    ...(r.ias ? { ias: r.ias } : {}),
  }))
  esquecerLoteEmCache()
}

function governancaComGlobal(tetoUsd: number, janela: string): void {
  const caminho = join(BASE, `tier-${seqRun}-${janela}.json`)
  writeFileSync(caminho, JSON.stringify({
    versao: 1,
    padrao: 'tier2_padrao',
    criterios: {},
    orcamentoPorCard: { tetoUsd: 16, acaoAoEstourar: 'pausar' },
    orcamentoGlobal: { tetoUsd, janela },
  }))
  process.env.HICODE_TIER_FILE = caminho
}

test('sem env e sem orcamentoGlobal no arquivo, o teto global fica DESLIGADO e nunca bloqueia', () => {
  const g = lerTetoGlobal(AGORA)
  expect(g.origem).toBe('desligado')
  expect(g.bloqueado).toBe(false)
  expect(despachoLiberado(AGORA).pode).toBe(true)
})

test('HICODE_BUDGET_USD soma o gasto de TODOS os provedores na janela e drena o despacho ao atingir', () => {
  escreverRun({ custo: 3, provedor: 'claude', haMs: 2 * HORA })
  escreverRun({ custo: 2.5, provedor: 'codex', haMs: 1 * HORA })
  process.env.HICODE_BUDGET_USD = '5'
  const g = lerTetoGlobal(AGORA)
  expect(g.origem).toBe('env')
  expect(g.runs).toBe(2)
  expect(g.gastoUsd).toBe(5.5)
  expect(g.bloqueado).toBe(true)
  expect(g.liberaEm).toBe(new Date(AGORA - 2 * HORA + 24 * HORA).toISOString())
  const d = despachoLiberado(AGORA)
  expect(d.pode).toBe(false)
  expect(d.motivo).toContain('US$5')
  expect(d.motivo).toContain('em voo terminam')
})

test('abaixo do teto o despacho segue liberado', () => {
  process.env.HICODE_BUDGET_USD = '50'
  const g = lerTetoGlobal(AGORA)
  expect(g.bloqueado).toBe(false)
  expect(despachoLiberado(AGORA).pode).toBe(true)
})

test('orcamentoGlobal do arquivo vale quando nao ha env, e a janela configurada descarta run velho', () => {
  governancaComGlobal(2, '30m')
  const g = lerTetoGlobal(AGORA)
  expect(g.origem).toBe('arquivo')
  expect(g.janelaMs).toBe(HORA / 2)
  expect(g.runs).toBe(0)
  expect(g.bloqueado).toBe(false)
})

test('a env VENCE o arquivo', () => {
  governancaComGlobal(2, '24h')
  process.env.HICODE_BUDGET_USD = '50'
  const g = lerTetoGlobal(AGORA)
  expect(g.origem).toBe('env')
  expect(g.tetoUsd).toBe(50)
})

test('gasto com chamada sem custo medido marca gastoEPiso — o teto esta operando sobre um piso', () => {
  escreverRun({ custo: 1, provedor: 'codex', haMs: HORA / 2, ias: [{ provedor: 'codex', custoUsd: 1, custoMedido: false, tokens: 10, chamadas: 1 }] })
  process.env.HICODE_BUDGET_USD = '1'
  const g = lerTetoGlobal(AGORA)
  expect(g.bloqueado).toBe(true)
  expect(g.gastoEPiso).toBe(true)
  expect(despachoLiberado(AGORA).motivo).toContain('piso medido')
})

test('governanca ILEGIVEL e fail-open: o teto global desliga com aviso em vez de derrubar o tick', () => {
  const caminho = join(BASE, 'tier-corrompido.json')
  writeFileSync(caminho, '{ nao e json')
  process.env.HICODE_TIER_FILE = caminho
  const g = lerTetoGlobal(AGORA)
  expect(g.origem).toBe('desligado')
  expect(g.bloqueado).toBe(false)
})

test('com o teto atingido, o estado do motor vira orcamento-esgotado e a leitura vai inteira na saude', () => {
  process.env.HICODE_BUDGET_USD = '1'
  const saude = lerSaudeDoMotor(AGORA)
  expect(saude.orcamentoGlobal.bloqueado).toBe(true)
  expect(saude.estado).toBe('orcamento-esgotado')
})
