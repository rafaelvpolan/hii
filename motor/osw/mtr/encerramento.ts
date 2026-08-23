import { quantosEmVoo } from './estado-da-fila'

// MTR — encerramento gracioso. Ao receber SIGTERM o motor para de ACEITAR card
// novo, espera o job em andamento terminar e so entao sai.
//
// Sem isto, todo deploy vira um crash nao-gracioso. A retomada
// (motor/euc/recuperar.ts) cobre esse caso de qualquer jeito — mas cobrir por
// acidente e pior que cobrir por design: o card volta a rodar do comeco de uma
// fase que ja estava quase pronta, e o custo em token e real.

const TETO_PADRAO_MS = Number(process.env.HICODE_SHUTDOWN_TIMEOUT_MS || 30_000)

let drenando = false
let graciosoInstalado = false

export function encerrando(): boolean {
  return drenando
}

// Quem mais registra handler de sinal precisa saber que ha um dono do
// encerramento — senao sai do processo antes de a fila drenar.
export function temEncerramentoGracioso(): boolean {
  return graciosoInstalado
}

export function pedirEncerramento(): void {
  drenando = true
}

// so para teste: o daemon real nunca volta atras
export function cancelarEncerramento(): void {
  drenando = false
  graciosoInstalado = false
}

export interface Drenagem {
  readonly limpo: boolean
  readonly restaram: number
}

export async function esperarFilaEsvaziar(
  tetoMs: number = TETO_PADRAO_MS,
  agora: () => number = Date.now,
  dormir: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms)),
): Promise<Drenagem> {
  const limite = agora() + tetoMs
  while (quantosEmVoo() > 0 && agora() < limite) await dormir(50)
  const restaram = quantosEmVoo()
  return { limpo: restaram === 0, restaram }
}

export interface OpcoesDeEncerramento {
  readonly log: (linha: string) => void
  readonly sair: (codigo: number) => void
  readonly tetoMs?: number
}

export async function encerrarComGraca(op: OpcoesDeEncerramento): Promise<void> {
  pedirEncerramento()
  op.log('[runner] SIGTERM recebido — parando de aceitar card novo e esperando o que esta em voo\n')
  const r = await esperarFilaEsvaziar(op.tetoMs)
  if (r.limpo) {
    op.log('[runner] fila drenada, encerrando limpo\n')
    op.sair(0)
    return
  }
  // Sair com codigo != 0 e deliberado: o job foi cortado no meio, e quem
  // orquestra o container precisa saber que este encerramento nao foi limpo.
  op.log(`[runner] teto de espera estourou com ${r.restaram} job(s) em voo — encerrando assim mesmo; a retomada cobre no proximo arranque\n`)
  op.sair(1)
}

export function instalarShutdownGracioso(op: OpcoesDeEncerramento): void {
  graciosoInstalado = true
  for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sinal, () => { void encerrarComGraca(op) })
  }
}
