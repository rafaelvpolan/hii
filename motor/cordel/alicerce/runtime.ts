import { spawnSync } from 'node:child_process'
import { ENV_RUNTIME } from './contrato.ts'

// Alicerce — qual runtime de JS o motor usa para rodar os proprios scripts auxiliares
// e para (re)subir o daemon.
//
// Existe porque o codigo spawnava 'bun' fixo em cinco lugares. Os scripts
// auxiliares sao .mjs — ESM puro, que node roda igual — e o motor em si e
// TypeScript de sintaxe apagavel, que o node 24 roda com type stripping nativo.
// Prender o binario em codigo transformava "roda em qualquer lugar" numa promessa
// que a primeira imagem sem bun desmentia.
//
// Runtime desconhecido LANCA. Cair no padrao seria escolher binario diferente do
// que o operador pediu e nao contar.

export const RUNTIMES = ['bun', 'node'] as const

export type Runtime = (typeof RUNTIMES)[number]

export interface EscolhaDeRuntime {
  readonly runtime: Runtime
  readonly motivo: string
}

function ehRuntime(v: string): v is Runtime {
  return (RUNTIMES as readonly string[]).includes(v)
}

function estaNoPath(bin: string): boolean {
  return spawnSync(bin, ['--version'], { stdio: 'ignore', timeout: 5000 }).status === 0
}

// A escolha custa um spawnSync de `bun --version`. `eOMotor` chama isto, e
// `daemonPid()` chama `eOMotor` — que a TUI consulta a cada quadro (~400ms).
// Sem memo, o painel abria um processo por quadro so para descobrir um valor que
// nao muda durante a vida do processo.
//
// A chave e o valor cru da env: se o operador (ou um teste) trocar ENV_RUNTIME, a
// resposta muda junto. Cache que ignora a propria entrada seria pior que nao ter.
let memo: { readonly chave: string; readonly escolha: EscolhaDeRuntime } | null = null

export function esquecerRuntime(): void {
  memo = null
}

export function escolhaDeRuntime(): EscolhaDeRuntime {
  const pedido = (process.env[ENV_RUNTIME] ?? '').trim()
  if (memo && memo.chave === pedido) return memo.escolha
  const escolha = decidirRuntime(pedido)
  memo = { chave: pedido, escolha }
  return escolha
}

function decidirRuntime(pedido: string): EscolhaDeRuntime {
  if (pedido) {
    if (!ehRuntime(pedido)) {
      throw new Error(`${ENV_RUNTIME}="${pedido}" nao e um runtime suportado (${RUNTIMES.join(' | ')}) — escolher outro binario em silencio seria rodar algo que o operador nao pediu`)
    }
    return { runtime: pedido, motivo: `pedido em ${ENV_RUNTIME}` }
  }
  if (estaNoPath('bun')) return { runtime: 'bun', motivo: 'bun encontrado no PATH' }
  return { runtime: 'node', motivo: 'bun ausente do PATH — node roda os scripts .mjs e o TS por type stripping (node 24+)' }
}

export function runtimeDeScript(): Runtime {
  return escolhaDeRuntime().runtime
}
