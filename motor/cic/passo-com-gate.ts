import { isoNow } from '../cdl/index.ts'
import type { FailureClass, StepMetric } from '../cdl/index.ts'
import { maxReajuste, GATE_RETRIES } from '../cdl/ali/config.ts'
import { patchCard } from '../cdl/store.ts'
import { runStep } from './agente.ts'
import { runGatedReview, withGateRetry } from './crv/gate.ts'
import { anexarEvento } from '../euc/eventos.ts'
import { abrirPrompt, anexarInstrucao, montar } from '../tmd/eco/prefixo.ts'
import type { GateResult } from './crv/gate.ts'

export interface GatedDeps {
  runStep: typeof runStep
  runGatedReview: typeof runGatedReview
}

export const SUFIXO_DO_GATE = ' · crivo'

export interface GatedResult {
  metric: StepMetric
  metricaDoGate: StepMetric
  ok: boolean
  text: string
  reason: string
  failureClass?: FailureClass
  failureReason?: string
  provider?: string
}

function review(id: string, wt: string, base: string, desc: string, label: string, revisar: typeof runGatedReview): Promise<GateResult> {
  return withGateRetry(
    () => revisar(wt, base, desc, id),
    reason => patchCard(id, {}, `${isoNow()} gate crivo [${label}]: NAO EXECUTOU (${reason}) — repetindo o gate sem reexecutar o agente`),
  )
}

export async function runGatedStep(id: string, wt: string, base: string, agent: string, instruction: string, desc: string, label: string, deps: GatedDeps = { runStep, runGatedReview }): Promise<GatedResult> {
  const t0 = Date.now()
  let cost = 0
  let costMeasured = true
  let tokens = 0
  let custoDoGate = 0
  let tokensDoGate = 0
  let medidoNoGate = true
  let tempoNoGate = 0
  let text = ''
  let reason = ''
  let attempt = 0
  const metric = (): StepMetric => ({ time: Math.max(0, Math.round((Date.now() - t0) / 1000) - tempoNoGate), cost, tokens, costMeasured })
  const metricaDoGate = (): StepMetric => ({ time: tempoNoGate, cost: custoDoGate, tokens: tokensDoGate, costMeasured: medidoNoGate })
  anexarEvento({ card: id, evento: 'fase_inicio', fase: label, detalhe: agent })
  // ECO: a instrucao vira prefixo fixo e cada reprovacao do crivo e ANEXADA.
  // Antes o sufixo era substituido a cada volta, entao o prompt da tentativa 3
  // nao era extensao do da tentativa 2 e o cache de prefixo do provedor so
  // pegava a instrucao inicial. Anexando, o trecho cacheavel cresce a cada
  // volta — e o agente ainda passa a ver o que ja foi rejeitado antes.
  let prompt = abrirPrompt(instruction)
  while (attempt <= maxReajuste()) {
    // repair_attempt so a partir da 2a volta: a 1a e execucao, nao reparo.
    if (attempt > 0) {
      anexarEvento({ card: id, evento: 'repair_attempt', fase: label, detalhe: `tentativa ${attempt + 1}: ${reason}` })
      prompt = anexarInstrucao(prompt, `\nO revisor CRIVO reprovou a tentativa ${attempt}: ${reason}. Corrija exatamente isso, sem quebrar o resto nem desfazer o que ja estava certo.`)
    }
    const r = await deps.runStep(wt, agent, montar(prompt), id)
    cost += r.cost
    costMeasured = costMeasured && r.costMeasured
    tokens += r.tokens
    text = r.text
    if (!r.ok) {
      if (r.failureClass && r.failureClass !== 'transient') {
        // fase_fim aqui tambem: sem ele, uma falha LIMPA pareceria fase
        // interrompida por crash na leitura do diario (motor/euc/recuperar.ts).
        anexarEvento({ card: id, evento: 'fase_fim', fase: label, detalhe: `agente falhou: ${r.failureClass}` })
        return { metric: metric(), metricaDoGate: metricaDoGate(), ok: false, text, reason: `agente ${agent} falhou (${r.failureReason ?? 'erro'})`, failureClass: r.failureClass, failureReason: r.failureReason, provider: r.provider }
      }
      reason = `agente ${agent} falhou/timeout`
      patchCard(id, {}, `${isoNow()} step [${label}] ${agent}: FALHOU/timeout (tentativa ${attempt + 1})`)
      attempt++
      continue
    }
    const tGate = Date.now()
    anexarEvento({ card: id, evento: 'gate_start', fase: label, detalhe: 'crivo' })
    const gate = await review(id, wt, base, `${desc} — etapa "${label}" (${agent})`, label, deps.runGatedReview)
    anexarEvento({ card: id, evento: 'gate_verdict', fase: label, detalhe: gate.ok ? gate.verdict : `NAO EXECUTOU: ${gate.reason}` })
    tempoNoGate += Math.round((Date.now() - tGate) / 1000)
    custoDoGate += gate.cost
    medidoNoGate = medidoNoGate && gate.costMeasured
    tokensDoGate += gate.tokens
    patchCard(id, {}, `${isoNow()} gate crivo [${label}]: ${gate.ok ? gate.verdict : 'NAO EXECUTOU'}${gate.reason ? ` — ${gate.reason}` : ''}`)
    if (!gate.ok) {
      anexarEvento({ card: id, evento: 'fase_fim', fase: label, detalhe: 'crivo indisponivel' })
      return { metric: metric(), metricaDoGate: metricaDoGate(), ok: false, text, reason: `crivo indisponivel apos ${GATE_RETRIES + 1} tentativa(s): ${gate.reason}`, failureClass: gate.failureClass, failureReason: gate.failureReason, provider: gate.provider }
    }
    if (gate.verdict !== 'BLOCKED') {
      anexarEvento({ card: id, evento: 'fase_fim', fase: label, detalhe: 'aprovada' })
      return { metric: metric(), metricaDoGate: metricaDoGate(), ok: true, text, reason: '' }
    }
    reason = gate.reason
    attempt++
  }
  anexarEvento({ card: id, evento: 'fase_fim', fase: label, detalhe: `esgotou tentativas: ${reason}` })
  return { metric: metric(), metricaDoGate: metricaDoGate(), ok: false, text, reason }
}
