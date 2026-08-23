import { run } from '../../qlb/git'
import { emptyUsage } from '../uso'
import { COST_UNKNOWN } from '../../euc/tsr/custo'
import { modoResolvido } from '../modos'
import type { AgentMode, AgentRequest, AgentResult, Harness, HarnessCapabilities, HarnessId, SinaisDoHarness } from '../tipos'
import { alcancavelPorHttp } from '../sonda'
import type { Usage } from '../../cdl'

interface CodexEvent {
  type?: string
  item?: { type?: string; text?: string }
  usage?: { input_tokens?: number; output_tokens?: number; cached_input_tokens?: number }
}

function sandbox(mode: AgentMode): string {
  return mode === 'edit' ? 'workspace-write' : 'read-only'
}

export function argv(req: AgentRequest, workdir: string): string[] {
  const aprovacao = modoResolvido('codex', req.modo)
  const a = ['exec', req.prompt, '-C', workdir, '--sandbox', sandbox(req.mode), '-c', `approval_policy="${aprovacao}"`, '--json']
  if (req.model) a.push('-m', req.model)
  if (req.effort) a.push('-c', `model_reasoning_effort="${req.effort}"`)
  for (const d of req.dirs.slice(1)) a.push('--add-dir', d)
  return a
}

function parse(stdout: string): { text: string; usage: Usage; isError: boolean } {
  let text = ''
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
    }
  }
  return { text, usage, isError }
}

const URL_DA_API = 'https://api.openai.com'

export const CODEX_CAPACIDADES: HarnessCapabilities = {
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

  capabilities(): HarnessCapabilities { return CODEX_CAPACIDADES }
  healthCheck(): Promise<boolean> { return alcancavelPorHttp(URL_DA_API) }
  sinaisDeFalha(): SinaisDoHarness { return CODEX_SINAIS }

  async run(req: AgentRequest): Promise<AgentResult> {
    const workdir = req.dirs[0] ?? req.cwd
    const { err, stdout, stderr } = await run('codex', argv(req, workdir), { cwd: workdir, timeout: req.timeoutMs })
    const parsed = parse(stdout)
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
