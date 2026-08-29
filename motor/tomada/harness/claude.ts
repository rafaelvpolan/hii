import { claudeArgv, CLAUDE_MODOS } from './claude-argv.ts'
import { claudeAutenticado, planoDoClaude } from '../../euclides/tesouro/planos.ts'
export { agentsArgv, claudeArgv, toolsFor } from './claude-argv.ts'
import { run } from '../../quilombo/git.ts'
import { emptyUsage } from '../uso.ts'
import { COST_UNKNOWN, readReportedCost } from '../../euclides/tesouro/custo.ts'
import { runClaudeStream } from './claude-stream.ts'
import type { CostReading } from '../../euclides/tesouro/custo.ts'
import type { AgentRole, AgentRequest, AgentResult, CatalogoDeModo, CorDeMarca, Harness, HarnessCapabilities, HarnessId, PlanoDoProvedor, SinaisDoHarness } from '../tipos.ts'
import { alcancavelPorHttp } from '../sonda.ts'
import { GATE_MODEL, VERIFY_MODEL } from '../../cordel/alicerce/config.ts'

interface ClaudeJson {
  total_cost_usd?: number
  result?: string
  is_error?: boolean
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
}


const URL_DA_API = 'https://api.anthropic.com'

export const CLAUDE_CAPACIDADES: HarnessCapabilities = {
  restrictsTools: true,      // --allowedTools em toda chamada
  isolatesReadonly: true,    // modo readonly cai em Read,Glob,Grep
  acceptsEffort: true,       // --effort
  reportsCostUsd: true,      // total_cost_usd no JSON
  reportsTokens: true,
  mcp: true,                 // unico harness com extraTools ligado hoje
}

export const CLAUDE_SINAIS: SinaisDoHarness = {
  terminal: [],
  quota: [{ pattern: /claude ai usage limit reached|5-hour limit reached|weekly limit reached/i, reason: 'limite de uso da assinatura Claude atingido' }],
  transient: [{ pattern: /overloaded_error|\bapi_error\b/i, reason: 'erro transitorio da API Anthropic' }],
}

export class ClaudeProvider implements Harness {
  readonly name: HarnessId = 'claude'
  readonly supportsAgents = true
  readonly supportsVision = true
  readonly agentic = true

  readonly modos: CatalogoDeModo = CLAUDE_MODOS
  readonly cor: CorDeMarca = { r: 218, g: 119, b: 86 }
  readonly binario = 'claude'
  readonly exigeCliNoPath = true
  readonly comandoDeLogin: readonly string[] = ['claude', '/login']
  readonly rodaLocal = false
  readonly temLeitorDePlano = true

  prontoParaUso(): boolean { return true }
  // De proposito NAO le HICODE_CLAUDE_MODEL: o claude usa o modelo padrao do
  // proprio CLI fora de verify/gate, e era assim antes desta refatoracao.
  modeloPadraoPara(papel: AgentRole): string | undefined {
    if (papel === 'verify') return VERIFY_MODEL
    if (papel === 'gate') return GATE_MODEL
    return undefined
  }
  comoObterQuandoAusente(): string { return 'instale o CLI do Claude Code' }
  autenticado(): boolean { return claudeAutenticado() }
  plano(agoraMs: number): PlanoDoProvedor { return planoDoClaude(agoraMs) }
  modelosDisponiveis(): string[] { return this.plano(Date.now()).modelos }
  capabilities(): HarnessCapabilities { return CLAUDE_CAPACIDADES }
  healthCheck(): Promise<boolean> { return alcancavelPorHttp(URL_DA_API) }
  sinaisDeFalha(): SinaisDoHarness { return CLAUDE_SINAIS }

  async run(req: AgentRequest): Promise<AgentResult> {
    if (req.liveLog) return runClaudeStream(req, req.liveLog)
    const { err, stdout, stderr } = await run('claude', claudeArgv(req), { cwd: req.cwd, timeout: req.timeoutMs })
    let reading: CostReading = COST_UNKNOWN
    let text = ''
    let isError = false
    let usage = emptyUsage()
    try {
      const j = JSON.parse(stdout) as ClaudeJson
      reading = readReportedCost(j.total_cost_usd)
      text = String(j.result ?? '')
      isError = !!j.is_error
      const u = j.usage ?? {}
      usage = {
        tokens_in: u.input_tokens || 0,
        tokens_out: u.output_tokens || 0,
        tokens_cache_create: u.cache_creation_input_tokens || 0,
        tokens_cache_read: u.cache_read_input_tokens || 0,
      }
    } catch {
      text = String(stdout || stderr || '')
    }
    const failed = !!err
    return {
      ok: !failed && !isError,
      failed,
      timedOut: !!err?.killed,
      isError,
      detail: err ? String(err.message || '') : '',
      text,
      ...reading,
      usage,
    }
  }
}
