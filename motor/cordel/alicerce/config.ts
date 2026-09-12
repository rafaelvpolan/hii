import { join, dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ENV_CARDS_DIR, ENV_REPOS_FILE, ENV_ROOT, ENV_SKILLS_DIR } from './contrato.ts'
import type { ClasseDeEspera } from '../tipos.ts'

// As variaveis do motor mudaram de prefixo (HICODE_ -> HII_) em 12/09/2026. Quem
// ainda sobe o motor com o nome antigo continua funcionando: o valor e copiado
// para o nome novo se este nao estiver definido, e o aviso sai UMA vez no stderr
// para o operador migrar sem pressa. O motor le SOMENTE HII_* daqui em diante.
export const PREFIXO_ANTIGO_DE_ENV = 'HICODE_'
export const PREFIXO_DE_ENV = 'HII_'

export function herdarEnvsAntigas(env: NodeJS.ProcessEnv = process.env, avisar: (linha: string) => void = l => process.stderr.write(l)): string[] {
  const herdadas: string[] = []
  for (const [chave, valor] of Object.entries(env)) {
    if (!chave.startsWith(PREFIXO_ANTIGO_DE_ENV) || valor === undefined) continue
    const nova = `${PREFIXO_DE_ENV}${chave.slice(PREFIXO_ANTIGO_DE_ENV.length)}`
    if (env[nova] !== undefined) continue
    env[nova] = valor
    herdadas.push(chave)
  }
  if (herdadas.length) avisar(`[hii] ${herdadas.length} variavel(is) com o prefixo antigo HICODE_ (${herdadas.join(', ')}) — o motor passou a ler HII_*; renomeie no ambiente, o valor foi herdado desta vez\n`)
  return herdadas
}

herdarEnvsAntigas()


const MARCADORES = ['runner.ts', 'cards', join('config', 'repos.json')]

function hasRepoMarkers(dir: string): boolean {
  return MARCADORES.some(m => existsSync(join(dir, m)))
}

function resolveRoot(): string {
  if (process.env[ENV_ROOT]) return process.env[ENV_ROOT]
  const fromModule = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
  if (hasRepoMarkers(fromModule)) return fromModule
  for (const c of [process.cwd(), resolve(process.cwd(), '..')]) {
    if (hasRepoMarkers(c)) return c
  }
  return fromModule
}

export const ROOT = resolveRoot()
export function cardsDir(): string {
  return process.env[ENV_CARDS_DIR] || join(ROOT, 'cards')
}

export function diretorioDeSkills(): string {
  return process.env[ENV_SKILLS_DIR] || join(ROOT, 'skills')
}

export function reposFile(): string {
  return process.env[ENV_REPOS_FILE] || join(ROOT, 'config', 'repos.json')
}
export function numeroDeEnv(nome: string, padrao: number): number {
  const bruto = process.env[nome]
  if (bruto === undefined || bruto === '') return padrao
  const n = Number(bruto)
  if (!Number.isFinite(n) || n < 0) {
    process.stderr.write(`[hicode] ${nome}="${bruto}" nao e numero valido — usando ${padrao}\n`)
    return padrao
  }
  return n
}

export const WT_BASE = join(dirname(ROOT), '.hicode-worktrees')
export const PREVIEW_BASE_PORT = numeroDeEnv('HII_PREVIEW_BASE', 5200)
export const POLL_MS = numeroDeEnv('HII_POLL_MS', 5000)
export const RUN_TIMEOUT_MS = numeroDeEnv('HII_RUN_TIMEOUT_MS', 900000)
export const MAX_CONCURRENCY = numeroDeEnv('HII_CONCURRENCY', 3)
// Orcamento da URL de preview: quanto o motor espera o dev-server responder,
// a que ritmo sonda, e o teto da inspecao via playwright. Tudo com o default
// de antes — parametrizar nao muda comportamento, so expoe o botao.
export const URL_WAIT_S = numeroDeEnv('HII_URL_WAIT_S', 30)
export const URL_PROBE_INTERVAL_MS = numeroDeEnv('HII_URL_PROBE_INTERVAL_MS', 1000)
export const URL_PROBE_TIMEOUT_MS = numeroDeEnv('HII_URL_PROBE_TIMEOUT_MS', 5000)
export const URL_INSPECT_TIMEOUT_MS = numeroDeEnv('HII_URL_INSPECT_TIMEOUT_MS', 60000)
export const URL_FREEPORT_SETTLE_MS = numeroDeEnv('HII_URL_FREEPORT_SETTLE_MS', 400)
// Liga as exigencias da Onda 5 que BARRAM em vez de so registrar: RED antes do
// GREEN (item 5), setup ferramental em area nova (item 22) e matriz de
// entendimento antes de aprovar o plano (item 4).
//
// Opt-in no CODIGO por decisao, e nao por pendencia: ligar e ato de operacao, e
// quem liga escolhe o momento em que os cards em voo podem parar. Em producao ja
// esta LIGADO, declarado em docker-stack.yml (`HII_RIGOR_ESTRITO:-1`), onde o
// momento e o deploy. Local e suite seguem desligados; `export HII_RIGOR_ESTRITO=1`
// liga.
//
// Enquanto desligado, as tres exigencias ficam REGISTRADAS no card
// (`red_antes_do_green`, `setup_ferramental`, `matriz_entendimento`), o que ja
// torna visivel quem passou sem provar.
export function rigorEstrito(): boolean {
  return process.env.HII_RIGOR_ESTRITO === '1'
}

// Pipeline de polimento MANUAL por padrao: url aprovada, o card para em PAUSED
// e cada passo (arquitetura, testes, seguranca, limpeza) so roda quando o humano
// pede (/polimento, /testes, ... na TUI, ou `hii passo <id> <passo>`); /hii ou
// ENTER rodam o restante de uma vez. Saiu da observacao do card #005: o motor
// gastava os quatro passos pagos em sequencia sem o humano ter visto a url.
// Opt-in de volta ao automatico: campo `pipeline: auto` no card (por tarefa) ou
// HII_PIPELINE=auto (global). O campo do card vence o env quando presente.
export function pipelineManual(fm?: { pipeline?: string }): boolean {
  const modo = fm?.pipeline || process.env.HII_PIPELINE || 'manual'
  return modo !== 'auto'
}

export function maxReajuste(): number {
  return numeroDeEnv('HII_REAJUSTE_RETRIES', 2)
}
export const MAX_CONFLICT = numeroDeEnv('HII_CONFLICT_RETRIES', 2)
export const GATE_RETRIES = numeroDeEnv('HII_GATE_RETRIES', 1)
export const MERGE_POLL_MS = numeroDeEnv('HII_MERGE_POLL_MS', 30000)
export const VERIFY_MODEL = process.env.HII_VERIFY_MODEL || 'sonnet'
export const GATE_MODEL = process.env.HII_GATE_MODEL || 'sonnet'
export const GATE_DIFF_LIMIT = numeroDeEnv('HII_GATE_DIFF_LIMIT', 60000)
export const GATE_TIMEOUT_MIN_MS = numeroDeEnv('HII_GATE_TIMEOUT_MIN_MS', 180000)
export const GATE_TIMEOUT_MAX_MS = numeroDeEnv('HII_GATE_TIMEOUT_MAX_MS', 600000)
export const GATE_TIMEOUT_MS_PER_KB = numeroDeEnv('HII_GATE_TIMEOUT_MS_PER_KB', 4000)
export const VISUAL_AI = (process.env.HII_VISUAL_AI || 'off') === 'on'
export const CLARIFY = (process.env.HII_CLARIFY || 'on') !== 'off'
export const EVAL = (process.env.HII_EVAL || 'on') !== 'off'
export const URL_AUTO_OK = (process.env.HII_URL_AUTO_OK || 'on') !== 'off'
export function evalMin(): number {
  if (process.env.HII_EVAL_MIN === 'off') return -1
  return numeroDeEnv('HII_EVAL_MIN', 1)
}
export const PROJECT_MEMORY = (process.env.HII_PROJECT_MEMORY || 'on') !== 'off'
export function maxWaitingAttempts(): number {
  return numeroDeEnv('HII_WAITING_MAX_ATTEMPTS', 8)
}

// PISO da espera, por classe — nao substitui a escada de backoff, so a levanta.
// `rede` devolve 0 de proposito: e o comportamento de hoje, intacto, e por isso a
// mudanca nunca piora nada (o default de quem nao informa classe e `rede`).
//
// O piso de `timeout` e o proprio RUN_TIMEOUT_MS, e o criterio e simetria: se o
// provedor consumiu o teto INTEIRO sem responder, retentar antes de ter esperado o
// mesmo tanto e pagar de novo pela mesma parede. Se o operador aumenta o teto de
// execucao, o piso acompanha sozinho.
export function pisoDeEsperaMs(classe: ClasseDeEspera): number {
  if (classe === 'timeout') return numeroDeEnv('HII_ESPERA_PISO_TIMEOUT_MS', RUN_TIMEOUT_MS)
  if (classe === 'taxa') return numeroDeEnv('HII_ESPERA_PISO_TAXA_MS', 60_000)
  return 0
}
// Ligado por omissao desde 09/09 (R: no PENDENCIAS): com o roteador de rotas
// conferindo aptidao (autenticacao, cota, capacidade do papel), trocar de provedor
// deixou de ser salto no escuro. HII_QUOTA_FALLBACK=off devolve o comportamento
// antigo: parar e chamar o humano na primeira cota esgotada.
export function quotaFallbackLigado(): boolean {
  return (process.env.HII_QUOTA_FALLBACK || 'on') === 'on'
}
