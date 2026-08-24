import { readDaemonHealth } from './tick.ts'
import { pending, quantosEmVoo } from '../../osw/mtr/estado-da-fila.ts'
import { encerrando } from '../../osw/mtr/encerramento.ts'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'

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

// Loopback por padrao. Servidor HTTP sem `hostname` liga em 0.0.0.0, o que exporia
// o /health a qualquer cliente que alcance a porta na rede — sem autenticacao.
// Expor alem do loopback passa a exigir intencao explicita do operador.
export function enderecoDeSaude(): string {
  return process.env.HICODE_HEALTH_BIND || '127.0.0.1'
}

export interface RespostaDeSaude {
  readonly status: number
  readonly corpo: string
}

export function respostaDeSaude(caminho: string): RespostaDeSaude {
  if (caminho !== '/health') return { status: 404, corpo: 'nao encontrado\n' }
  const s = lerSaude()
  return { status: s.ok ? 200 : 503, corpo: `${JSON.stringify(s)}\n` }
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
  const servidor = createServer((req: IncomingMessage, res: ServerResponse) => {
    const caminho = (req.url ?? '/').split('?')[0] ?? '/'
    const r = respostaDeSaude(caminho)
    res.writeHead(r.status, { 'content-type': r.status === 404 ? 'text/plain' : 'application/json' })
    res.end(r.corpo)
  })
  servidor.listen(alvo, enderecoDeSaude())
  const endereco = servidor.address()
  const efetiva = typeof endereco === 'object' && endereco ? endereco.port : alvo
  return { porta: efetiva, parar: (): void => { servidor.close() } }
}
