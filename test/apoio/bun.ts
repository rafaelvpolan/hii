import { readFile } from 'node:fs/promises'
import { spawn, type ChildProcess } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { setTimeout as esperar } from 'node:timers/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

// Pontes para as APIs globais do Bun que a suite usa. Inventariadas, nao adivinhadas:
// `Bun.file(x).text()` (56 usos), `Bun.serve` (26), `Bun.spawn` (6), `Bun.sleep` (6)
// e `Bun.which` (1). Cada uma vira uma funcao com nome proprio, para o passo de troca
// mecanica ser um `sed` e nao uma releitura de 232 arquivos.

export function lerArquivo(caminho: string): Promise<string> {
  return readFile(caminho, 'utf8')
}

export function dormir(ms: number): Promise<void> {
  return esperar(ms).then(() => undefined)
}

export function qualBinario(nome: string): string | null {
  try {
    return execFileSync('sh', ['-c', `command -v ${nome}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null
  } catch {
    return null
  }
}

export interface ProcessoDeTeste {
  readonly pid: number | undefined
  readonly filho: ChildProcess
  // `exitCode` so tem valor DEPOIS de `encerrou`; antes disso e null, igual ao Bun.
  readonly exitCode: number | null
  readonly encerrou: Promise<number | null>
  kill(sinal?: NodeJS.Signals): void
  // Texto acumulado ate agora. O Bun entrega um stream; aqui a suite so precisa do
  // texto, e acumular desde o spawn evita perder o que saiu antes de alguem ler.
  saidaPadrao(): string
  saidaDeErro(): string
  saida(): Promise<{ code: number | null; stdout: string; stderr: string }>
}

export interface OpcoesDeProcesso {
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
  readonly stdout?: 'pipe' | 'ignore' | 'inherit'
  readonly stderr?: 'pipe' | 'ignore' | 'inherit'
}

export function rodar(argv: readonly string[], opcoes: OpcoesDeProcesso = {}): ProcessoDeTeste {
  const [cmd, ...args] = argv
  const filho = spawn(cmd ?? '', args, {
    cwd: opcoes.cwd,
    env: opcoes.env,
    stdio: ['ignore', opcoes.stdout ?? 'pipe', opcoes.stderr ?? 'pipe'],
  })
  let out = ''
  let err = ''
  let codigo: number | null = null
  filho.stdout?.on('data', (d: Buffer) => { out += d.toString('utf8') })
  filho.stderr?.on('data', (d: Buffer) => { err += d.toString('utf8') })
  const encerrou = new Promise<number | null>((resolve) => {
    filho.on('close', (c) => { codigo = c; resolve(c) })
  })
  return {
    get pid() { return filho.pid },
    filho,
    get exitCode() { return codigo },
    encerrou,
    kill: (sinal) => { filho.kill(sinal ?? 'SIGTERM') },
    saidaPadrao: () => out,
    saidaDeErro: () => err,
    saida: async () => ({ code: await encerrou, stdout: out, stderr: err }),
  }
}

export interface ServidorDeTeste {
  readonly port: number
  readonly url: string
  stop(forcar?: boolean): Promise<void>
}

// A forma segue a do `Bun.serve` de proposito: o handler recebe um `Request` e
// devolve um `Response` (ambos globais no Node 24 e no Bun), e o objeto tem `port` e
// `stop`. Assim os 10 arquivos que sobem servidor mudam a CHAMADA e nao o corpo do
// handler — e handler reescrito e onde um teste de rede muda de sentido sem ninguem
// perceber.
//
// A unica diferenca visivel: aqui e assincrono, porque `listen` do node so sabe a
// porta no callback. Os chamadores usam `await` no topo do modulo.
export async function servidorDeTeste(fetch: (req: Request) => Response | Promise<Response>): Promise<ServidorDeTeste> {
  const servidor: Server = createServer((req, res) => {
    const pedacos: Buffer[] = []
    req.on('data', (d: Buffer) => { pedacos.push(d) })
    req.on('end', () => {
      const porta = (servidor.address() as AddressInfo).port
      const temCorpo = req.method !== 'GET' && req.method !== 'HEAD'
      // Num servidor usado como PROXY o cliente manda a URL ABSOLUTA na linha de
      // pedido (`GET http://alvo/ HTTP/1.1`), e nao o caminho. Prefixar o host ali
      // monta "http://127.0.0.1:41195http://alvo/" e o `Request` recusa.
      const caminho = req.url ?? '/'
      const alvo = /^[a-z][a-z0-9+.-]*:\/\//i.test(caminho) ? caminho : `http://127.0.0.1:${porta}${caminho}`
      const pedido = new Request(alvo, {
        method: req.method,
        headers: Object.entries(req.headers).flatMap(([k, v]) => (v === undefined ? [] : [[k, Array.isArray(v) ? v.join(', ') : v] as [string, string]])),
        body: temCorpo && pedacos.length ? Buffer.concat(pedacos) : undefined,
      })
      void Promise.resolve(fetch(pedido))
        .then(async (r) => {
          const corpo = Buffer.from(await r.arrayBuffer())
          const cabecalhos: Record<string, string> = {}
          r.headers.forEach((v, k) => { cabecalhos[k] = v })
          // `Content-Length` explicito, como o `Bun.serve` faz sozinho. Sem ele o
          // node responde em chunked, e um teste que depende do TAMANHO ANUNCIADO
          // (teto de download recusado antes de baixar) deixa de testar o que
          // testava — passa por outro caminho, ou nao passa. Fidelidade da ponte e
          // o que separa migrar de reescrever o teste sem perceber.
          if (cabecalhos['content-length'] === undefined && !('transfer-encoding' in cabecalhos)) {
            cabecalhos['content-length'] = String(corpo.byteLength)
          }
          res.writeHead(r.status, cabecalhos)
          res.end(corpo)
        })
        .catch(() => { res.writeHead(500); res.end('') })
    })
  })
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', () => ok()))
  const port = (servidor.address() as AddressInfo).port
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    // `stop(true)` do Bun derruba conexoes abertas. `closeAllConnections` faz o
    // mesmo; sem ele o `close` fica pendurado esperando keep-alive e a suite trava
    // no afterAll.
    stop: (forcar) => new Promise((ok) => {
      if (forcar !== false) servidor.closeAllConnections()
      servidor.close(() => ok())
    }),
  }
}
