import { readDaemonHealth } from './tick'
import { pending, quantosEmVoo } from '../../osw/mtr/estado-da-fila'
import { encerrando } from '../../osw/mtr/encerramento'

// RDR — observabilidade de INFRAESTRUTURA, distinta da observabilidade de
// decisao de IA (que e o diario EUC). Serve para systemd, politica de restart
// do Docker e load balancer de qualquer nuvem saberem quando reiniciar.
//
// Desligado por padrao: abrir porta na maquina de alguem sem pedir nao e
// comportamento aceitavel para uma ferramenta local. Em container, defina
// HICODE_HEALTH_PORT.

export interface Saude {
  readonly ok: boolean
  readonly encerrando: boolean
  readonly emVoo: number
  readonly pendentes: number
  readonly falhasSeguidasNoTick: number
  readonly ultimoErro: string
}

// O /health nao devolve a mensagem crua de erro. reportTickFailure grava
// `${context}: ${error.message}` (motor/euc/rdr/tick.ts), o que tipicamente
// carrega caminho absoluto, nome de usuario do host e codigo de erro do SO —
// informacao de reconhecimento para quem alcanca a porta. O contexto (a fase
// que falhou) basta para o orquestrador decidir reiniciar; o texto completo
// continua no arquivo de saude local, para quem tem acesso ao disco.
export function categoriaDoErro(mensagem: string): string {
  if (!mensagem) return ''
  const contexto = mensagem.split(':')[0] ?? ''
  return contexto.trim() ? `falha em ${contexto.trim()}` : 'erro interno'
}

export function lerSaude(): Saude {
  const h = readDaemonHealth()
  return {
    // Drenando ainda e "de pe", mas nao esta ok para receber trabalho novo:
    // o orquestrador deve tirar este processo do balanceamento.
    ok: h.consecutiveFailures === 0 && !encerrando(),
    encerrando: encerrando(),
    emVoo: quantosEmVoo(),
    pendentes: pending().length,
    falhasSeguidasNoTick: h.consecutiveFailures,
    ultimoErro: categoriaDoErro(h.lastError),
  }
}

export function portaDeSaude(): number {
  return Number(process.env.HICODE_HEALTH_PORT || 0)
}

// Loopback por padrao. Bun.serve sem `hostname` liga em 0.0.0.0, o que exporia
// o /health a qualquer cliente que alcance a porta na rede — sem autenticacao.
// Expor alem do loopback passa a exigir intencao explicita do operador.
export function enderecoDeSaude(): string {
  return process.env.HICODE_HEALTH_BIND || '127.0.0.1'
}

export function respostaDeSaude(caminho: string): Response {
  if (caminho !== '/health') return new Response('nao encontrado\n', { status: 404 })
  const s = lerSaude()
  return new Response(`${JSON.stringify(s)}\n`, {
    status: s.ok ? 200 : 503,
    headers: { 'content-type': 'application/json' },
  })
}

export interface ServidorDeSaude {
  readonly porta: number
  parar(): void
}

// porta === null: le HICODE_HEALTH_PORT e, se nao houver, NAO sobe nada.
// porta explicita (inclusive 0, que pede uma porta livre ao SO): sobe sempre.
// Os dois significados de 0 precisavam ficar separados.
export function subirServidorDeSaude(porta: number | null = null): ServidorDeSaude | null {
  const alvo = porta === null ? portaDeSaude() : porta
  if (porta === null && !alvo) return null
  const s = Bun.serve({
    port: alvo,
    hostname: enderecoDeSaude(),
    fetch: (req): Response => respostaDeSaude(new URL(req.url).pathname),
  })
  return { porta: s.port ?? alvo, parar: (): void => { void s.stop(true) } }
}
