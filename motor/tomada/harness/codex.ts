import { run } from '../../quilombo/git.ts'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { emptyUsage } from '../uso.ts'
import { COST_UNKNOWN } from '../../euclides/tesouro/custo.ts'
import { resolverModo } from '../modo-puro.ts'
import { codexAutenticado } from '../../euclides/tesouro/planos.ts'
import type { AgentMode, AgentRequest, AgentResult, CatalogoDeModo, CorDeMarca, Harness, HarnessCapabilities, HarnessId, PlanoDoProvedor, SinaisDoHarness } from '../tipos.ts'
import { planoDoCodex } from '../../euclides/tesouro/planos.ts'
import { cliSaudavel } from '../sonda.ts'
import { AcumuladorDeLinhas, cabecalhoDaChamada, carimboAgora, comRaia, linhaDeConclusao } from './live-log.ts'
import type { Usage } from '../../cordel/index.ts'

// O Codex CLI 0.149+ aposentou `untrusted`; manter esse valor aqui faz o
// processo abortar antes de executar a pergunta. Preferencias antigas caem
// para `never` via resolverModo.
export const CODEX_MODOS: CatalogoDeModo = { modos: ['never', 'on-request'], padrao: 'never' }

interface CodexEvent {
  type?: string
  message?: string
  item?: { type?: string; text?: string; command?: string; path?: string }
  usage?: { input_tokens?: number; output_tokens?: number; cached_input_tokens?: number }
}

function sandbox(mode: AgentMode): string {
  return mode === 'edit' ? 'workspace-write' : 'read-only'
}

export function argv(req: AgentRequest, workdir: string): string[] {
  const aprovacao = resolverModo(CODEX_MODOS, req.modo)
  const a = ['exec', req.prompt, '-C', workdir, '--sandbox', sandbox(req.mode), '-c', `approval_policy="${aprovacao}"`, '--json']
  if (req.model) a.push('-m', req.model)
  if (req.effort) a.push('-c', `model_reasoning_effort="${req.effort}"`)
  for (const d of req.dirs.slice(1)) a.push('--add-dir', d)
  return a
}

function parse(stdout: string): { text: string; usage: Usage; isError: boolean } {
  let text = ''
  let errorText = ''
  let isError = false
  const usage = emptyUsage()
  for (const line of stdout.split('\n')) {
    const t = line.trim()
    if (!t || t[0] !== '{') continue
    let ev: CodexEvent
    try { ev = JSON.parse(t) as CodexEvent } catch { continue }
    if (ev.type === 'item.completed' && ev.item?.type === 'agent_message' && ev.item.text) {
      text = ev.item.text
    } else if (ev.type === 'turn.completed' && ev.usage) {
      usage.tokens_in = ev.usage.input_tokens || 0
      usage.tokens_out = ev.usage.output_tokens || 0
      usage.tokens_cache_read = ev.usage.cached_input_tokens || 0
    } else if (ev.type === 'error' || ev.type === 'turn.failed') {
      isError = true
      if (ev.message) errorText = [errorText, ev.message].filter(Boolean).join('\n')
    }
  }
  return { text: [text, errorText].filter(Boolean).join('\n'), usage, isError }
}

export function linhasDoLiveLog(stdout: string): string[] {
  const linhas: string[] = []
  for (const line of stdout.split('\n')) {
    const t = line.trim()
    if (!t || t[0] !== '{') continue
    let ev: CodexEvent
    try { ev = JSON.parse(t) as CodexEvent } catch { continue }
    if (ev.type !== 'item.completed' || !ev.item?.type) continue
    if (ev.item.type === 'agent_message') { if (ev.item.text) linhas.push(ev.item.text) }
    else if (ev.item.type === 'command_execution') linhas.push(`  → Bash(${JSON.stringify({ command: ev.item.command ?? '' })})`)
    else if (ev.item.type === 'file_change') linhas.push(`  → Edit(${JSON.stringify({ file_path: ev.item.path ?? '' })})`)
    else linhas.push(`  → ${ev.item.type}(${JSON.stringify({ description: ev.item.text ?? '' })})`)
  }
  return linhas
}

function mensagemDeErroDaLinha(line: string): string {
  try {
    const ev = JSON.parse(line) as CodexEvent
    if (ev.type === 'error' || ev.type === 'turn.failed') return ev.message || 'Codex informou uma falha'
  } catch {
    return ''
  }
  return ''
}

interface LiveCodexLog {
  stdout: AcumuladorDeLinhas
  stderr: AcumuladorDeLinhas
  linha: (line: string) => void
  finalizar: (err: { message?: string; killed?: boolean } | null) => void
}

function liveCodexLog(req: AgentRequest): LiveCodexLog | null {
  if (!req.liveLog) return null
  const caminho = req.liveLog
  try {
    const dir = dirname(caminho)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    appendFileSync(caminho, `\n${cabecalhoDaChamada(carimboAgora(), req.rotulo)}\n`)
  } catch {
    return null
  }
  const escrever = (texto: string): void => {
    try { appendFileSync(caminho, comRaia(texto, req.raia)) } catch { void 0 }
  }
  const stdout = new AcumuladorDeLinhas()
  const stderr = new AcumuladorDeLinhas()
  const linha = (line: string): void => {
    if (!line.trim()) return
    const humanas = linhasDoLiveLog(line)
    if (humanas.length) {
      escrever(humanas.map(l => `${l}\n`).join(''))
      return
    }
    const erro = mensagemDeErroDaLinha(line)
    if (erro) escrever(`— falha do Codex: ${erro}\n`)
    else if (line.trim()[0] !== '{') escrever(`${line}\n`)
  }
  return {
    stdout,
    stderr,
    linha,
    finalizar: (err) => {
      for (const l of stdout.esvaziar()) linha(l)
      for (const l of stderr.esvaziar()) escrever(`${l}\n`)
      if (err?.killed) return
      if (err) escrever(`— falha: ${String(err.message || 'execucao encerrada com erro').replace(/\s+/g, ' ').slice(0, 300)} —\n`)
      else escrever(`${linhaDeConclusao()}\n`)
    },
  }
}

const URL_DA_API = 'https://api.openai.com'

export const CODEX_CAPACIDADES: HarnessCapabilities = {
  emitsStructuredJson: true,
  restrictsTools: true,      // --sandbox
  isolatesReadonly: true,    // --sandbox read-only quando mode !== edit
  acceptsEffort: true,       // model_reasoning_effort
  reportsCostUsd: false,     // devolve COST_UNKNOWN
  reportsTokens: true,
  mcp: false,                // o CLI suporta, mas este motor nao liga extraTools nele
}

export const CODEX_SINAIS: SinaisDoHarness = {
  terminal: [],
  quota: [{ pattern: /insufficient_quota|exceeded_quota/i, reason: 'cota da API OpenAI esgotada' }],
  transient: [{ pattern: /rate_limit_exceeded/i, reason: 'limite de taxa da API OpenAI' }],
}

export class CodexProvider implements Harness {
  readonly name: HarnessId = 'codex'
  readonly supportsAgents = false
  readonly supportsVision = false
  readonly agentic = true

  readonly modos: CatalogoDeModo = CODEX_MODOS
  readonly cor: CorDeMarca = { r: 16, g: 163, b: 127 }
  readonly binario = 'codex'
  readonly exigeCliNoPath = true
  readonly comandoDeLogin: readonly string[] = ['codex', 'login']
  readonly rodaLocal = false
  readonly temLeitorDePlano = true

  modeloPadraoPara(): string | undefined { return process.env.HII_CODEX_MODEL || undefined }
  prontoParaUso(): boolean { return true }
  comoObterQuandoAusente(): string { return 'instale o CLI do Codex' }
  autenticado(): boolean { return codexAutenticado() }
  plano(agoraMs: number): PlanoDoProvedor { return planoDoCodex(agoraMs) }
  modelosDisponiveis(): string[] { return [] }
  capabilities(): HarnessCapabilities { return CODEX_CAPACIDADES }
  healthCheck(): Promise<boolean> { return cliSaudavel(this.binario, URL_DA_API) }
  sinaisDeFalha(): SinaisDoHarness { return CODEX_SINAIS }

  async run(req: AgentRequest): Promise<AgentResult> {
    const workdir = req.dirs[0] ?? req.cwd
    const live = liveCodexLog(req)
    const { err, stdout, stderr } = await run('codex', argv(req, workdir), {
      cwd: workdir,
      timeout: req.timeoutMs,
      aoIniciar: req.aoIniciar,
      aoLerStdout: (pedaco) => {
        for (const line of live?.stdout.empurrar(pedaco) ?? []) live?.linha(line)
      },
      aoLerStderr: (pedaco) => {
        for (const line of live?.stderr.empurrar(pedaco) ?? []) live?.linha(line)
      },
      aoEstourarTempo: () => {
        try { appendFileSync(req.liveLog ?? '', comRaia('— TIMEOUT: encerrando a IA —\n', req.raia)) } catch { void 0 }
      },
    })
    const parsed = parse(stdout)
    live?.finalizar(err)
    const failed = !!err
    return {
      ok: !failed && !parsed.isError,
      failed,
      timedOut: !!err?.killed,
      isError: parsed.isError,
      detail: err ? String(err.message || '') : '',
      text: parsed.text || String(stdout || stderr || ''),
      ...COST_UNKNOWN,
      usage: parsed.usage,
    }
  }
}
