import { readDaemonHealth } from './tick.ts'
import { pending, quantosEmVoo } from '../../oswaldo/mutirao/estado-da-fila.ts'
import { encerrando } from '../../oswaldo/mutirao/encerramento.ts'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ENV_HEALTH_BIND, ENV_HEALTH_PORT } from '../../cordel/alicerce/contrato.ts'

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
// `${context}: ${error.message}` (motor/euclides/radar/tick.ts), o que tipicamente
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

// Porta ILEGIVEL ('8O80', '-1', '80 x') virava NaN/negativo e, em
// subirServidorDeSaude, `!alvo` tratava isso como "nao configurado": o servidor
// nao subia em silencio. Com HEALTHCHECK no Dockerfile o operador via o container
// unhealthy sem uma linha explicando. Ausente e diferente de corrompido.
export function portaDeSaude(): number {
  const cru = String(process.env[ENV_HEALTH_PORT] ?? '').trim()
  if (!cru) return 0
  const n = Number(cru)
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    process.stderr.write(`[hicode] ${ENV_HEALTH_PORT}="${cru}" nao e uma porta valida (0-65535) — o servidor de /health NAO vai subir. Corrija a variavel; o HEALTHCHECK do container vai reprovar sem isto.\n`)
    return 0
  }
  return n
}

// Loopback por padrao. Servidor HTTP sem `hostname` liga em 0.0.0.0, o que exporia
// o /health a qualquer cliente que alcance a porta na rede — sem autenticacao.
// Expor alem do loopback passa a exigir intencao explicita do operador.
export function enderecoDeSaude(): string {
  return process.env[ENV_HEALTH_BIND] || '127.0.0.1'
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
  // Lido no momento da pergunta: com porta 0 (efemera), o SO so decide durante o
  // `listen`, que e assincrono.
  readonly porta: number
  // Resolve com a porta efetiva quando o servidor esta ouvindo, ou 0 se falhou.
  readonly pronto: Promise<number>
  parar(): void
}

// porta === null: le HICODE_HEALTH_PORT e, se nao houver, NAO sobe nada.
// porta explicita (inclusive 0, que pede uma porta livre ao SO): sobe sempre.
// Os dois significados de 0 precisavam ficar separados.
export function subirServidorDeSaude(porta: number | null = null): ServidorDeSaude | null {
  const alvo = porta === null ? portaDeSaude() : porta
  if (porta === null && !alvo) return null
  const servidor = createServer((req: IncomingMessage, res: ServerResponse) => {
    // try/catch obrigatorio: `respostaDeSaude` chama `pending()` -> `allCards()`,
    // que faz readFileSync por card. Um card apagado/arquivado entre o readdirSync
    // e o readFileSync (um `hii rm` concorrente) lancava DENTRO do callback HTTP —
    // excecao nao capturada, daemon derrubado por uma sonda externa. A porta de
    // observabilidade nao pode matar o motor que ela observa.
    try {
      const caminho = (req.url ?? '/').split('?')[0] ?? '/'
      const r = respostaDeSaude(caminho)
      res.writeHead(r.status, { 'content-type': r.status === 404 ? 'text/plain' : 'application/json' })
      res.end(r.corpo)
    } catch (e) {
      const motivo = String((e as Error)?.message ?? e).slice(0, 200)
      process.stderr.write(`[hicode] /health falhou ao montar a resposta (${motivo}) — respondendo 503; o motor segue\n`)
      try {
        res.writeHead(503, { 'content-type': 'application/json' })
        res.end(`${JSON.stringify({ ok: false, erro: 'nao consegui ler o estado', detalhe: motivo })}\n`)
      } catch {
        // Conexao ja fechada pelo cliente: nada a fazer, e nao pode virar excecao.
        void 0
      }
    }
  })
  // Sem listener de 'error', EADDRINUSE/EACCES (segunda instancia, socket residual
  // apos restart do container, porta <1024) derrubava o PROCESSO INTEIRO por causa
  // de uma porta auxiliar de observabilidade. O /health nao e caminho critico do
  // motor: se ele nao sobe, o motor tem de continuar e o operador tem de saber.
  servidor.on('error', (e: NodeJS.ErrnoException) => {
    process.stderr.write(`[hicode] o servidor de /health NAO subiu em ${enderecoDeSaude()}:${alvo} (${e.code ?? e.message}) — o motor segue trabalhando, mas nenhuma sonda externa vai responder (o HEALTHCHECK do container vai reprovar)\n`)
  })
  // `listen` e ASSINCRONO no node (o runtime de producao): ler `address()` na linha
  // seguinte devolvia null, e `subirServidorDeSaude(0)` — porta efemera pedida ao
  // SO — respondia porta 0, ou seja quem chamou nunca descobria onde o servidor
  // subiu. Sob bun funcionava por acidente de implementacao, e era so isso que
  // mantinha o teste verde. `portaEfetiva()` le no momento da pergunta.
  servidor.listen(alvo, enderecoDeSaude())
  const portaEfetiva = (): number => {
    const endereco = servidor.address()
    return typeof endereco === 'object' && endereco ? endereco.port : alvo
  }
  return {
    get porta(): number { return portaEfetiva() },
    pronto: new Promise<number>((resolve) => {
      if (servidor.listening) { resolve(portaEfetiva()); return }
      servidor.once('listening', () => resolve(portaEfetiva()))
      servidor.once('error', () => resolve(0))
    }),
    parar: (): void => { servidor.close() },
  }
}
