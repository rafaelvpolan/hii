import { isoAt, isoNow } from '../../cordel/index.ts'
import type { ClasseDeEspera, Fields, FailureClass } from '../../cordel/index.ts'
import { maxWaitingAttempts, pisoDeEsperaMs } from '../../cordel/alicerce/config.ts'
import { patchCard, readCard } from '../../cordel/store.ts'
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
  extraFields?: Fields
}

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
    wait_attempts: '',
    wait_reason: '',
    wait_class: '',
    wait_until: '',
    wait_resume_status: '',
    wait_provider: '',
    ...input.extraFields,
  }
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
    patchCard(input.id, haltFields(input), `${isoNow()} ${input.fromStatus}->HALTED cota do provedor ${input.provider || 'desconhecido'} esgotada: ${input.failureReason} — motor PARADO (sem troca automatica de provedor); configure HICODE_QUOTA_FALLBACK para permitir troca explicita`)
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
