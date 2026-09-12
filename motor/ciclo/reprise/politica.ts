import { isoAt, isoNow } from '../../cordel/index.ts'
import type { ClasseDeEspera, Fields, FailureClass } from '../../cordel/index.ts'
import { maxWaitingAttempts, pisoDeEsperaMs, quotaFallbackLigado } from '../../cordel/alicerce/config.ts'
import { patchCard, readCard } from '../../cordel/store.ts'
import { campoDeOverrideDoPapel, comTentativaDeRota, decidirRota, rotaTentadas } from '../../tomada/rota.ts'
import type { DecisaoDeRota, EntradaDeRota } from '../../tomada/rota.ts'
import type { AgentRole } from '../../tomada/tipos.ts'
import { appendFailureAttempt } from './tentativas.ts'
import type { FailureOutcome } from './tentativas.ts'
import { stampRunFailure } from '../../euclides/registros.ts'

export type ResumeStatus = 'EXECUTING' | 'URL_OK' | 'CORRECTING' | 'SPECCED'

export type PolicyOutcome = FailureOutcome

export interface FailurePolicyInput {
  id: string
  fromStatus: string
  resumeStatus: ResumeStatus
  provider: string
  failureClass: FailureClass
  failureReason: string
  technicalDetail: string
  // Opcional, e o default e o comportamento de hoje: quem nao informa cai em `rede`,
  // cujo piso e zero. Informar so melhora — nenhum caminho fica mais curto do que
  // era.
  waitClass?: ClasseDeEspera
  resumeStep?: string
  papel?: AgentRole
  rota?: (e: EntradaDeRota) => DecisaoDeRota
  extraFields?: Fields
}

const PAPEIS_COM_OVERRIDE_DE_PROVEDOR: readonly AgentRole[] = ['implement', 'step', 'gate', 'verify']

const BACKOFF_STEPS_MS = [30_000, 60_000, 120_000, 300_000, 600_000]

export const CLASSE_DE_ESPERA_PADRAO: ClasseDeEspera = 'rede'

// A escada continua sendo a escada; a classe so LEVANTA o degrau. Sem classe, o piso
// e zero e o resultado e identico ao de antes desta funcao ter segundo parametro —
// e e assim que `somaDosBackoffs` em euclides/radar/saude.ts, que reconstroi o
// passado, nao passa a mentir sobre cards gravados antes de `wait_class` existir.
export function backoffMsFor(attempt: number, classe: ClasseDeEspera = CLASSE_DE_ESPERA_PADRAO): number {
  const idx = Math.min(Math.max(attempt, 1), BACKOFF_STEPS_MS.length) - 1
  const escada = BACKOFF_STEPS_MS[idx] ?? 600_000
  return Math.max(escada, pisoDeEsperaMs(classe))
}

function haltFields(input: FailurePolicyInput): Fields {
  return {
    status: 'HALTED',
    halt_class: input.failureClass,
    halt_provider: input.provider,
    halt_reason: input.failureReason,
    halt_at: isoNow(),
    pipeline_liberado: '',
    pipeline_passo: '',
    wait_attempts: '',
    wait_reason: '',
    wait_class: '',
    wait_until: '',
    wait_resume_status: '',
    wait_provider: '',
    rota_tentados: '',
    provider_override_implement: '',
    provider_override_step: '',
    provider_override_gate: '',
    provider_override_verify: '',
    ...input.extraFields,
  }
}

function trocaDeProvedorPorQuota(input: FailurePolicyInput, attempts: number): PolicyOutcome | null {
  if (!quotaFallbackLigado()) return null
  if (!input.papel || !PAPEIS_COM_OVERRIDE_DE_PROVEDOR.includes(input.papel)) return null
  const tentadosNoCard = readCard(input.id)?.fm.rota_tentados
  const tentados = rotaTentadas(tentadosNoCard)
  const rota = (input.rota ?? decidirRota)({ papel: input.papel, classeDeFalha: input.failureClass, provedorAtual: input.provider, tentadosNestaRodada: tentados })
  if (rota.acao !== 'trocar') return null
  const until = isoAt(Date.now() + backoffMsFor(attempts, 'rede'))
  patchCard(input.id, {
    status: 'WAITING',
    [campoDeOverrideDoPapel(input.papel)]: rota.para,
    rota_tentados: comTentativaDeRota(tentadosNoCard, input.provider),
    wait_reason: input.failureReason,
    wait_attempts: String(attempts),
    wait_class: 'rede',
    wait_until: until,
    wait_resume_status: input.resumeStatus,
    wait_provider: rota.para,
    ...(input.resumeStep ? { resume_from: input.resumeStep } : {}),
    ...input.extraFields,
  }, `${isoNow()} ${input.fromStatus}->WAITING (tentativa ${attempts}/${maxWaitingAttempts()}) cota de ${input.provider || 'provedor'} esgotada — proxima tentativa em ${rota.para} as ${until} (${rota.motivo}; HII_QUOTA_FALLBACK=on; a espera e curta porque o retry NAO volta ao provedor esgotado)`)
  return 'waiting'
}

function recordFailure(input: FailurePolicyInput, attempt: number, outcome: PolicyOutcome): void {
  stampRunFailure(input.id, { failureClass: input.failureClass, failureReason: input.failureReason }, input.provider)
  appendFailureAttempt(input.id, {
    attempt,
    fromStatus: input.fromStatus,
    provider: input.provider,
    failureClass: input.failureClass,
    failureReason: input.failureReason,
    outcome,
  })
}

export function applyFailurePolicy(input: FailurePolicyInput): PolicyOutcome {
  const attempt = attemptNumber(input.id)
  const outcome = decideOutcome(input, attempt)
  recordFailure(input, attempt, outcome)
  return outcome
}

function attemptNumber(id: string): number {
  const card = readCard(id)
  return (Number(card?.fm.wait_attempts || '0') || 0) + 1
}

function decideOutcome(input: FailurePolicyInput, attempts: number): PolicyOutcome {
  if (input.failureClass === 'quota') {
    const trocado = trocaDeProvedorPorQuota(input, attempts)
    if (trocado) return trocado
    patchCard(input.id, haltFields(input), `${isoNow()} ${input.fromStatus}->HALTED cota do provedor ${input.provider || 'desconhecido'} esgotada: ${input.failureReason} — motor PARADO (sem troca automatica de provedor, ou sem candidato apto); configure HII_QUOTA_FALLBACK para permitir troca explicita`)
    return 'halt'
  }

  if (input.failureClass === 'terminal') {
    patchCard(input.id, haltFields(input), `${isoNow()} ${input.fromStatus}->HALTED ${input.failureReason} — ${input.technicalDetail}`)
    return 'halt'
  }

  if (attempts > maxWaitingAttempts()) {
    patchCard(input.id, haltFields(input), `${isoNow()} ${input.fromStatus}->HALTED esgotou ${maxWaitingAttempts()} tentativas de espera (${input.failureReason}) — ultimo erro: ${input.technicalDetail}`)
    return 'halt'
  }
  const classeDeEspera = input.waitClass ?? CLASSE_DE_ESPERA_PADRAO
  const atrasoMs = backoffMsFor(attempts, classeDeEspera)
  const until = isoAt(Date.now() + atrasoMs)
  const fields: Fields = {
    status: 'WAITING',
    wait_reason: input.failureReason,
    wait_attempts: String(attempts),
    // Gravada porque a espera SEGUINTE e decidida em outro processo
    // (reprise/espera.ts, no tick do daemon), que so tem o frontmatter na mao.
    wait_class: classeDeEspera,
    wait_until: until,
    wait_resume_status: input.resumeStatus,
    wait_provider: input.provider,
    ...(input.resumeStep ? { resume_from: input.resumeStep } : {}),
    ...input.extraFields,
  }
  patchCard(input.id, fields, `${isoNow()} ${input.fromStatus}->WAITING (tentativa ${attempts}/${maxWaitingAttempts()}) ${input.failureReason} [espera: ${classeDeEspera}] — proxima tentativa as ${until}, em ${Math.round(atrasoMs / 1000)}s`)
  return 'waiting'
}
