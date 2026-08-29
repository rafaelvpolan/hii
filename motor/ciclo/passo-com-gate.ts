import { isoNow } from '../cordel/index.ts'
import type { FailureClass, StepMetric } from '../cordel/index.ts'
import { maxReajuste, GATE_RETRIES } from '../cordel/alicerce/config.ts'
import { patchCard } from '../cordel/store.ts'
import { runStep } from './agente.ts'
import { runGatedReview, withGateRetry } from './crivo/gate.ts'
import { assinaturaDeVeredicto } from './reparo.ts'
import { anexarEvento } from '../euclides/eventos.ts'
import { abrirPrompt, anexarInstrucao, montar } from '../tomada/eco/prefixo.ts'
import type { GateResult } from './crivo/gate.ts'

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

export async function runGatedStep(id: string, wt: string, base: string, alvo: string, agent: string, instruction: string, desc: string, label: string, deps: GatedDeps = { runStep, runGatedReview }, packs: readonly string[] = []): Promise<GatedResult> {
  const t0 = Date.now()
  let cost = 0
  let costMeasured = true
  let tokens = 0
  let custoDoGate = 0
  let tokensDoGate = 0
  let medidoNoGate = true
  let tempoNoGate = 0
  let text = ''
  // DOIS motivos, nao um. Enquanto era uma variavel so, a falha do agente escrevia
  // nela e a volta seguinte anunciava "O revisor CRIVO reprovou: agente X
  // falhou/timeout" — uma reprovacao que nunca existiu, porque o gate nem chegou a
  // rodar naquela volta. Como o prompt e append-only (ECO), a frase falsa ficava
  // para sempre, inclusive depois de um BLOCKED legitimo.
  let motivoDoGate = ''
  let motivoDaFalha = ''
  let ultimaFalhaDoAgente: { failureClass?: FailureClass; failureReason?: string; provider?: string } | null = null
  // A reprovacao da volta anterior, normalizada. O teto de `maxReajuste()` conta
  // voltas e nao progresso: um agente que devolve a mesma coisa tres vezes paga
  // tres vezes e o diario ainda diz "esgotou reajustes", como se cada volta
  // tivesse tentado algo novo. Guardar a assinatura permite parar na SEGUNDA
  // reprovacao identica, que e o primeiro instante em que da para saber.
  let assinaturaDoGateAnterior = ''
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
      // O prompt fala da tentativa ANTERIOR: se ela terminou em falha do agente, e
      // disso que se fala, mesmo que um BLOCKED mais antigo ainda esteja guardado.
      const motivo = motivoDaFalha || motivoDoGate
      anexarEvento({ card: id, evento: 'repair_attempt', fase: label, detalhe: `tentativa ${attempt + 1}: ${motivo}` })
      // So atribui ao CRIVO o que o CRIVO disse. Falha de infraestrutura do agente
      // pede refazer, nao "corrigir exatamente isso" — instruir a corrigir um
      // achado inexistente convida a edicao espuria, em chamada paga.
      prompt = anexarInstrucao(prompt, motivoDaFalha
        ? `\nA tentativa ${attempt} nao chegou ao fim (${motivoDaFalha}). Refaca o passo do zero; nao ha achado de revisao para corrigir.`
        : `\nO revisor CRIVO reprovou a tentativa ${attempt}: ${motivoDoGate}. Corrija exatamente isso, sem quebrar o resto nem desfazer o que ja estava certo.`)
    }
    const r = await deps.runStep(wt, agent, montar(prompt), id, alvo, packs)
    cost += r.cost
    costMeasured = costMeasured && r.costMeasured
    tokens += r.tokens
    text = r.text
    if (!r.ok) {
      if (r.failureClass && r.failureClass !== 'transient') {
        // fase_fim aqui tambem: sem ele, uma falha LIMPA pareceria fase
        // interrompida por crash na leitura do diario (motor/euclides/recuperar.ts).
        anexarEvento({ card: id, evento: 'fase_fim', fase: label, detalhe: `agente falhou: ${r.failureClass}` })
        return { metric: metric(), metricaDoGate: metricaDoGate(), ok: false, text, reason: `agente ${agent} falhou (${r.failureReason ?? 'erro'})`, failureClass: r.failureClass, failureReason: r.failureReason, provider: r.provider }
      }
      // A causa ja classificada (agente.ts:309) ia para o lixo aqui: nem o prompt
      // nem o diario do card recebiam r.failureReason, e o humano lia so
      // "FALHOU/timeout" sem saber se foi cota, rede ou provedor.
      motivoDaFalha = `agente ${agent} nao concluiu: ${r.failureReason ?? r.failureClass ?? 'sem detalhe'}`
      // NAO apaga `motivoDoGate`: se o crivo JA reprovou numa volta anterior, essa
      // reprovacao continua valendo e e ela que decide o HALT. Zerar aqui fazia
      // "BLOCKED na tentativa 1 + falha do agente na 2" sair como "o agente nao
      // concluiu, o crivo nao reprovou nada" — perdendo a reprovacao real e
      // mandando o card para politica de espera em vez de HALT.
      // O PROMPT da volta seguinte continua usando `motivoDaFalha`, porque foi a
      // falha do agente que interrompeu esta tentativa.
      // A classificacao da ULTIMA falha transitoria e guardada. Sem ela, esgotar as
      // tentativas devolvia reason sem failureClass, o chamador nao entrava em
      // applyStepFailurePolicy e o diario do card dizia "gate crivo reprovou apos
      // N reajuste(s): agente X nao concluiu" — reprovacao atribuida ao CRIVO que
      // nunca existiu. O conserto anterior arrumou o PROMPT e nao o retorno.
      ultimaFalhaDoAgente = { failureClass: r.failureClass, failureReason: r.failureReason, provider: r.provider }
      patchCard(id, {}, `${isoNow()} step [${label}] ${agent}: NAO CONCLUIU (tentativa ${attempt + 1}) — ${r.failureReason ?? r.failureClass ?? 'sem detalhe'}`)
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
    const assinatura = assinaturaDeVeredicto(gate.reason)
    if (assinatura && assinatura === assinaturaDoGateAnterior) {
      anexarEvento({ card: id, evento: 'fase_fim', fase: label, detalhe: `sem progresso: crivo repetiu a mesma reprovacao na tentativa ${attempt + 1}` })
      patchCard(id, {}, `${isoNow()} gate crivo [${label}]: MESMA reprovacao da volta anterior — parando antes do teto de ${maxReajuste()} reajuste(s), porque a volta seguinte pagaria para receber este mesmo veredicto`)
      return { metric: metric(), metricaDoGate: metricaDoGate(), ok: false, text, reason: `o crivo reprovou com o MESMO motivo em duas voltas seguidas (sem progresso): ${gate.reason}` }
    }
    assinaturaDoGateAnterior = assinatura
    motivoDoGate = gate.reason
    motivoDaFalha = ''
    ultimaFalhaDoAgente = null
    attempt++
  }
  const motivoFinal = motivoDoGate || motivoDaFalha
  anexarEvento({ card: id, evento: 'fase_fim', fase: label, detalhe: `esgotou tentativas: ${motivoFinal}` })
  // Esgotou por falha do AGENTE (nao por BLOCKED do crivo): devolve a classificacao
  // para o chamador aplicar politica de espera/retry, em vez de o card HALTar com
  // uma reprovacao do crivo que nunca aconteceu.
  if (!motivoDoGate && ultimaFalhaDoAgente) {
    return {
      metric: metric(), metricaDoGate: metricaDoGate(), ok: false, text,
      reason: `o agente nao concluiu em ${attempt} tentativa(s) — o crivo nao reprovou nada: ${motivoFinal}`,
      failureClass: ultimaFalhaDoAgente.failureClass ?? 'transient',
      failureReason: ultimaFalhaDoAgente.failureReason ?? motivoFinal,
      provider: ultimaFalhaDoAgente.provider ?? '',
    }
  }
  return { metric: metric(), metricaDoGate: metricaDoGate(), ok: false, text, reason: motivoFinal }
}
