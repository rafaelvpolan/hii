import type { FailureClass } from '../../cordel/index.ts'
import type { Harness, SinalDeFalha, SinaisDoHarness } from '../../tomada/tipos.ts'

export interface FailureContext {
  timedOut: boolean
  detail: string
  text: string
}

export interface FailureClassification {
  failureClass: FailureClass
  reason: string
}

const TERMINAL_GENERIC: SinalDeFalha[] = [
  // `executable not found` e a frase do BUN, que e o runtime em que o motor de fato
  // roda (.bun-version, bin/hii.ts). O node diz `spawn ENOENT`, e so essa forma
  // estava coberta: sob bun, provedor nao instalado caia na ultima linha de
  // classifyFailure e o operador lia "falha nao reconhecida" em vez do motivo real.
  // A suite nao podia pegar isso enquanto so a trilha node rodava.
  { pattern: /enoent|command not found|no such file or directory|executable not found/i, reason: 'provedor nao instalado (binario nao encontrado)' },
  { pattern: /invalid[_ -]?api[_ -]?key|unauthorized|authentication[_ -]?error|please run\s*\/?login|\b401\b|\b403\b|forbidden/i, reason: 'credencial invalida' },
  { pattern: /invalid[_ -]?request[_ -]?error|malformed|\b400\b|unsupported (model|parameter)/i, reason: 'requisicao malformada' },
]

const QUOTA_GENERIC: SinalDeFalha[] = [
  { pattern: /insufficient[_ ]?quota|exceeded your current quota|quota exceeded|usage limit reached|your limit will reset|credit balance (is )?too low|billing hard limit|plan limit reached|monthly limit reached/i, reason: 'cota do provedor esgotada' },
]

const TRANSIENT_GENERIC: SinalDeFalha[] = [
  { pattern: /econnreset|econnrefused|enotfound|eai_again|etimedout|epipe|enetunreach|ehostunreach/i, reason: 'rede indisponivel' },
  { pattern: /socket hang up|network error|fetch failed|dns lookup failed|connection reset/i, reason: 'rede indisponivel' },
  { pattern: /\b(500|502|503|504)\b|bad gateway|service unavailable|gateway timeout|internal server error/i, reason: '5xx do provedor' },
  { pattern: /\b429\b|too many requests|rate.?limit(ed| exceeded)?/i, reason: 'limite de taxa (429)' },
  { pattern: /overloaded|temporarily unavailable|try again later|please retry|server is busy/i, reason: 'provedor temporariamente indisponivel' },
]

function firstMatch(haystack: string, signals: readonly SinalDeFalha[]): SinalDeFalha | undefined {
  return signals.find(s => s.pattern.test(haystack))
}

// Recebe o harness, nao o nome: os sinais especificos moram no proprio harness
// (motor/tomada/tipos.ts -> SinaisDoHarness). Antes havia um Record central aqui,
// o que obrigava todo harness novo a editar ciclo/ — justamente o que o item 1
// da Onda 2 elimina.
export type FonteDeSinais = Pick<Harness, 'sinaisDeFalha'>

export function classifyFailure(harness: FonteDeSinais, ctx: FailureContext): FailureClassification {
  if (ctx.timedOut) return { failureClass: 'transient', reason: 'timeout — provedor nao respondeu a tempo' }
  const haystack = `${ctx.detail}\n${ctx.text}`.slice(0, 4000)
  const table: SinaisDoHarness = harness.sinaisDeFalha()
  const terminal = firstMatch(haystack, table.terminal) ?? firstMatch(haystack, TERMINAL_GENERIC)
  if (terminal) return { failureClass: 'terminal', reason: terminal.reason }
  const quota = firstMatch(haystack, table.quota) ?? firstMatch(haystack, QUOTA_GENERIC)
  if (quota) return { failureClass: 'quota', reason: quota.reason }
  const transient = firstMatch(haystack, table.transient) ?? firstMatch(haystack, TRANSIENT_GENERIC)
  if (transient) return { failureClass: 'transient', reason: transient.reason }
  return { failureClass: 'terminal', reason: 'falha nao reconhecida — tratada como terminal (mais barato parar que repetir para sempre)' }
}
