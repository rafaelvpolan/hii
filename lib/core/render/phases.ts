export interface Phase {
  label: string
  states: string[]
  color: string
}

export const PHASES: Phase[] = [
  { label: 'Fila', states: ['INBOX', 'READY', 'SPECCED', 'PLAN_APPROVED'], color: '\x1b[90m' },
  { label: 'Executar', states: ['EXECUTING', 'EXECUTED'], color: '\x1b[33m' },
  { label: 'Url', states: ['URL', 'CORRECTING'], color: '\x1b[36m' },
  { label: 'Aprovado', states: ['URL_OK'], color: '\x1b[34m' },
  { label: 'Polir', states: ['REFINED', 'TESTS_GREEN', 'SEC_CLEARED', 'REVIEWED', 'CLEANED'], color: '\x1b[35m' },
  { label: 'PR', states: ['PR_OPEN', 'MERGED', 'DEPLOYED'], color: '\x1b[32m' },
]

export const WAITING_HUMAN = ['CLARIFY', 'URL', 'HALTED']

export function phaseIndex(status: string): number {
  return PHASES.findIndex(p => p.states.includes(status))
}

const ROTULO_FORA_DE_FASE: Record<string, string> = {
  CLARIFY: 'Pergunta',
  WAITING: 'Esperando',
  PAUSED: 'Pausado',
  HALTED: 'Parado',
}

export function phaseLabel(status: string): string {
  return PHASES[phaseIndex(status)]?.label ?? ROTULO_FORA_DE_FASE[status] ?? status
}

export function isActive(status: string): boolean {
  return ['EXECUTING', 'CORRECTING', 'SPECCED', 'URL_OK', 'REFINED', 'TESTS_GREEN', 'SEC_CLEARED', 'REVIEWED', 'CLEANED', 'WAITING'].includes(status)
}

export function waitsHuman(status: string): boolean {
  return WAITING_HUMAN.includes(status)
}

export interface EsperaHumano {
  motivo: string
  comando: string
}

const ESPERAS: Record<string, EsperaHumano> = {
  CLARIFY: { motivo: 'precisa da sua resposta — responda no proprio prompt', comando: '' },
  URL: { motivo: 'resultado pronto para voce ver', comando: '' },
  READY: { motivo: 'plano nao aprovado', comando: '' },
  INBOX: { motivo: 'plano nao aprovado', comando: '' },
  SPECCED: { motivo: 'plano nao aprovado', comando: '' },
  HALTED: { motivo: 'parou no meio', comando: '' },
  PR_OPEN: { motivo: 'PR aberto para voce revisar', comando: '' },
}

export function esperaHumano(status: string): EsperaHumano | null {
  return ESPERAS[status] ?? null
}
