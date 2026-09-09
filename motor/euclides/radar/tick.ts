import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isoNow } from '../../cordel/index.ts'
import { cardsDir } from '../../cordel/alicerce/config.ts'

export interface DaemonHealth {
  consecutiveFailures: number
  lastError: string
  lastErrorAt: string
  ticksSemProgresso: number
}

const EMPTY_HEALTH: DaemonHealth = { consecutiveFailures: 0, lastError: '', lastErrorAt: '', ticksSemProgresso: 0 }

const ESCALATE_AFTER = Number(process.env.HICODE_TICK_ESCALATE_AFTER || 3)

function healthFile(): string {
  return join(cardsDir(), 'runs', 'daemon-health.json')
}

interface PartialHealth {
  consecutiveFailures?: number
  lastError?: string
  lastErrorAt?: string
  ticksSemProgresso?: number
}

export function readDaemonHealth(): DaemonHealth {
  const f = healthFile()
  if (!existsSync(f)) return { ...EMPTY_HEALTH }
  try {
    return { ...EMPTY_HEALTH, ...(JSON.parse(readFileSync(f, 'utf8')) as PartialHealth) }
  } catch {
    return { ...EMPTY_HEALTH }
  }
}

function writeHealth(h: DaemonHealth): void {
  try {
    const dir = join(cardsDir(), 'runs')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(healthFile(), JSON.stringify(h, null, 2))
  } catch {
    void 0
  }
}

export function recordTickSuccess(): void {
  const prev = readDaemonHealth()
  if (prev.consecutiveFailures) writeHealth({ ...EMPTY_HEALTH, ticksSemProgresso: prev.ticksSemProgresso })
}

// "De pe e improdutivo" e diferente de "quebrando": o tick roda limpo, nao lanca
// nada, e a fila nao anda — foi assim que o card 002 ficou invisivel com o /health
// respondendo verde. Quem decide se o tick foi improdutivo e a fila (assinatura
// igual + pendentes sem ninguem em voo); aqui so se conta e persiste, porque o
// /health le deste arquivo em OUTRO processo.
export function registrarProgressoDoTick(improdutivo: boolean): void {
  const prev = readDaemonHealth()
  const atual = improdutivo ? prev.ticksSemProgresso + 1 : 0
  if (atual !== prev.ticksSemProgresso) writeHealth({ ...prev, ticksSemProgresso: atual })
}

export function reportTickFailure(context: string, error: Error): DaemonHealth {
  const message = `${context}: ${error.message || String(error)}`
  const prev = readDaemonHealth()
  const repeating = prev.lastError === message
  const health: DaemonHealth = {
    consecutiveFailures: repeating ? prev.consecutiveFailures + 1 : 1,
    lastError: message,
    lastErrorAt: isoNow(),
    ticksSemProgresso: prev.ticksSemProgresso,
  }
  writeHealth(health)
  const primeiraVez = !repeating
  const marco = health.consecutiveFailures % ESCALATE_AFTER === 0
  if (primeiraVez || marco) {
    const prefixo = health.consecutiveFailures >= ESCALATE_AFTER
      ? `ALERTA: tick falhando ha ${health.consecutiveFailures} ciclos seguidos com o MESMO erro — o daemon segue de pe, mas investigue`
      : 'ERRO no tick'
    process.stderr.write(`[runner] ${prefixo}: ${message}\n`)
  }
  return health
}
