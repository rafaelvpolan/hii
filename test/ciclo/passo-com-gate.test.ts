import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { GateResult } from '../../motor/ciclo/crivo/gate.ts'
import type { StepResult } from '../../motor/ciclo/agente.ts'
import type { GatedDeps } from '../../motor/ciclo/passo-com-gate.ts'

const CARDS = mkdtempSync(join(tmpdir(), 'hicode-gated-'))
process.env.HICODE_CARDS_DIR = CARDS
process.env.HICODE_REAJUSTE_RETRIES = '2'

interface Chamada {
  instrucao: string
  alvo: string
}

const stepCalls: Chamada[] = []
let stepQueue: StepResult[] = []
let gateQueue: GateResult[] = []

function step(over: Partial<StepResult>): StepResult {
  return { time: 1, cost: 0.01, costMeasured: true, tokens: 100, text: 'fez', ok: true, ...over }
}

function gate(over: Partial<GateResult>): GateResult {
  return { ok: true, verdict: 'APPROVED', reason: '', criterio: '', questions: [], cost: 0.02, costMeasured: true, tokens: 200, ...over }
}

const { createCard } = await import('../../motor/cordel/store.ts')
const { runGatedStep } = await import('../../motor/ciclo/passo-com-gate.ts')

const agente: GatedDeps = {
  runStep: (_wt: string, _agent: string, instruction: string, _id: string, alvo: string): Promise<StepResult> => {
    stepCalls.push({ instrucao: instruction, alvo })
    return Promise.resolve(stepQueue.shift() ?? step({}))
  },
  runGatedReview: (): Promise<GateResult> => Promise.resolve(gateQueue.shift() ?? gate({})),
}

afterAll(() => rmSync(CARDS, { recursive: true, force: true }))

function reset(steps: StepResult[], gates: GateResult[]): string {
  stepCalls.length = 0
  stepQueue = steps
  gateQueue = gates
  return createCard({ title: 'gated', status: 'REFINED' }, '## Objetivo\nalgo\n')
}

function run(id: string): Promise<{ ok: boolean; reason: string; metric: { cost: number; tokens: number }; metricaDoGate: { cost: number; tokens: number } }> {
  return runGatedStep(id, '/tmp/wt', 'main', '/tmp/wt', 'rufus', 'melhore X', 'objetivo', 'Arquitetura', agente)
}

test('agente ok + crivo aprova na primeira: passa sem retry', async () => {
  const id = reset([step({})], [gate({ verdict: 'APPROVED' })])
  const r = await run(id)
  expect(r.ok).toBe(true)
  expect(stepCalls.length).toBe(1)
})

test('CONDITIONAL nao reprova o step', async () => {
  const id = reset([step({})], [gate({ verdict: 'CONDITIONAL', reason: 'ressalva' })])
  expect((await run(id)).ok).toBe(true)
})

test('crivo BLOCKED reexecuta o agente com o motivo da reprovacao no prompt', async () => {
  const id = reset(
    [step({}), step({})],
    [gate({ verdict: 'BLOCKED', reason: 'acoplou demais' }), gate({ verdict: 'APPROVED' })],
  )
  const r = await run(id)
  expect(r.ok).toBe(true)
  expect(stepCalls.length).toBe(2)
  expect(stepCalls[0]?.instrucao).not.toContain('CRIVO reprovou')
  expect(stepCalls[1]?.instrucao).toContain('acoplou demais')
})

// Motivos DISTINTOS a cada volta: o crivo achou coisa nova toda vez, entao houve
// progresso e o laco tem mesmo de ir ate o teto. Enquanto o roteiro repetia
// 'segue quebrado' nas tres, este teste media a parada por nao-progresso
// acreditando medir o teto, e as duas guardas ficavam presas na mesma assercao.
test('BLOCKED persistente esgota as tentativas e devolve o motivo', async () => {
  const id = reset(
    [step({}), step({}), step({})],
    [
      gate({ verdict: 'BLOCKED', reason: 'segue quebrado: acoplamento' }),
      gate({ verdict: 'BLOCKED', reason: 'segue quebrado: nome ruim' }),
      gate({ verdict: 'BLOCKED', reason: 'segue quebrado: falta teste' }),
    ],
  )
  const r = await run(id)
  expect(r.ok).toBe(false)
  expect(r.reason).toContain('segue quebrado')
  expect(stepCalls.length).toBe(3)
})

test('o passo para quando o crivo REPETE a reprovacao — a volta seguinte pagaria para ouvir o mesmo', async () => {
  const bloqueado = gate({ verdict: 'BLOCKED', reason: 'segue quebrado' })
  const id = reset(
    [step({}), step({}), step({})],
    [bloqueado, bloqueado, bloqueado],
  )
  const r = await run(id)
  expect(r.ok).toBe(false)
  expect(r.reason, 'o motivo tem de dizer que foi repeticao, senao parece teto esgotado').toContain('sem progresso')
  expect(r.reason).toContain('segue quebrado')
  expect(stepCalls.length, 'a terceira volta nao devia ter sido paga').toBe(2)
})

test('agente que falha consome tentativa e nao chama o crivo', async () => {
  const id = reset(
    [step({ ok: false, text: 'timeout' }), step({})],
    [gate({ verdict: 'APPROVED' })],
  )
  const r = await run(id)
  expect(r.ok).toBe(true)
  expect(stepCalls.length).toBe(2)
})

test('REGRESSAO crivo indisponivel: repete o GATE, nao reexecuta o agente', async () => {
  const naoRodou = gate({ ok: false, verdict: 'CONDITIONAL', reason: 'gate NAO executou (timeout)' })
  const id = reset([step({}), step({}), step({})], [naoRodou, naoRodou, naoRodou])
  const r = await run(id)
  expect(r.ok).toBe(false)
  expect(r.reason).toContain('crivo indisponivel')
  expect(stepCalls.length).toBe(1)
})

test('REGRESSAO crivo falha e volta na repeticao: aproveita o trabalho ja feito', async () => {
  const naoRodou = gate({ ok: false, verdict: 'CONDITIONAL', reason: 'saida ilegivel' })
  const id = reset([step({})], [naoRodou, gate({ verdict: 'APPROVED' })])
  const r = await run(id)
  expect(r.ok).toBe(true)
  expect(stepCalls.length).toBe(1)
})

// Este teste passava vacuamente: com gate.ok=false o laco retorna antes de montar
// um segundo prompt, entao havia UMA stepCall (a inicial) e a asserção sobre
// "CRIVO reprovou" nunca podia ser verdadeira. Ele declarava a invariante e nao
// exercitava o caminho que a viola. O caso irmao — falha TRANSITORIA do agente, que
// consome tentativa e produz o prompt seguinte — nao tinha teste nenhum.
test('REGRESSAO crivo indisponivel nao vira reprovacao no prompt do agente', async () => {
  const naoRodou = gate({ ok: false, verdict: 'CONDITIONAL', reason: 'timeout' })
  const id = reset([step({}), step({})], [naoRodou, naoRodou])
  await run(id)
  expect(stepCalls.length, 'sem uma segunda chamada a asserção abaixo passaria vazia').toBe(1)
  expect(stepCalls.some(c => c.instrucao.includes('CRIVO reprovou'))).toBe(false)
})

test('REGRESSAO falha do AGENTE nao e reapresentada como reprovacao do CRIVO', async () => {
  // Falha transitoria (sem failureClass terminal) consome a tentativa e o laco
  // monta o prompt seguinte — e ali que a reprovacao fabricada aparecia.
  const id = reset(
    [step({ ok: false, text: 'timeout', failureReason: 'erro transitorio da API' }), step({})],
    [gate({ verdict: 'APPROVED' })],
  )
  await run(id)
  expect(stepCalls.length, 'o caminho que produz o segundo prompt precisa ter sido exercitado').toBe(2)
  const segundo = stepCalls[1]?.instrucao ?? ''
  expect(segundo, 'o crivo nem rodou nessa volta — atribuir a ele e inventar um achado').not.toContain('CRIVO reprovou')
  expect(segundo, 'a causa real tem de chegar ao agente, nao ser trocada por uma generica').toContain('erro transitorio da API')
})

test('REGRESSAO reprovacao REAL do crivo continua sendo atribuida ao crivo', async () => {
  const id = reset(
    [step({}), step({})],
    [gate({ verdict: 'BLOCKED', reason: 'c-erro: catch vazio' }), gate({ verdict: 'APPROVED' })],
  )
  await run(id)
  expect(stepCalls.length).toBe(2)
  const segundo = stepCalls[1]?.instrucao ?? ''
  expect(segundo).toContain('CRIVO reprovou')
  expect(segundo).toContain('c-erro: catch vazio')
})

test('custo do gate repetido entra na conta mesmo sem veredito, na metrica do gate', async () => {
  const naoRodou = gate({ ok: false, verdict: 'CONDITIONAL', reason: 'timeout', cost: 0.02, tokens: 200 })
  const id = reset([step({ cost: 0.01, tokens: 100 })], [naoRodou, naoRodou])
  const r = await run(id)
  expect(r.metric.cost).toBeCloseTo(0.01, 5)
  expect(r.metricaDoGate.cost).toBeCloseTo(0.04, 5)
  expect(r.metric.cost + r.metricaDoGate.cost).toBeCloseTo(0.05, 5)
  expect(r.metric.tokens + r.metricaDoGate.tokens).toBe(500)
})

test('agente e crivo viram metricas SEPARADAS — da para dizer quanto foi de cada um', async () => {
  const id = reset(
    [step({ cost: 0.01, tokens: 100 }), step({ cost: 0.01, tokens: 100 })],
    [gate({ verdict: 'BLOCKED', reason: 'x', cost: 0.02, tokens: 200 }), gate({ verdict: 'APPROVED', cost: 0.02, tokens: 200 })],
  )
  const r = await run(id)
  expect(r.metric.cost).toBeCloseTo(0.02, 5)
  expect(r.metric.tokens).toBe(200)
  expect(r.metricaDoGate.cost).toBeCloseTo(0.04, 5)
  expect(r.metricaDoGate.tokens).toBe(400)
})

test('REGRESSAO o total do passo continua fechando — separar nao pode perder custo', async () => {
  const id = reset(
    [step({ cost: 0.01, tokens: 100 }), step({ cost: 0.01, tokens: 100 })],
    [gate({ verdict: 'BLOCKED', reason: 'x', cost: 0.02, tokens: 200 }), gate({ verdict: 'APPROVED', cost: 0.02, tokens: 200 })],
  )
  const r = await run(id)
  expect(r.metric.cost + r.metricaDoGate.cost).toBeCloseTo(0.06, 5)
  expect(r.metric.tokens + r.metricaDoGate.tokens).toBe(600)
})


// O checklist de seguranca por stack (item 7) e o gatilho por dependencia so
// funcionam se o CAMINHO do alvo chegar ao agente. Enquanto `repo` tinha default,
// os call sites passavam 4 argumentos e o valor era sempre '' — o recurso estava
// morto e o teste que o guardava era um grep no texto-fonte de agente.ts, que
// passava verde do mesmo jeito. Este afirma sobre o argumento recebido.
test('PROPAGACAO o alvo chega ao runStep, e nao vazio', async () => {
  const id = reset([step({})], [gate({})])
  await runGatedStep(id, '/tmp/wt', 'main', '/caminho/do/alvo', 'rufus', 'melhore X', 'objetivo', 'Arquitetura', agente)
  expect(stepCalls.length).toBeGreaterThan(0)
  expect(stepCalls[0]?.alvo, 'sem o caminho do alvo o agente de seguranca nunca recebe o checklist da stack').toBe('/caminho/do/alvo')
})
