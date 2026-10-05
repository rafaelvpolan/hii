import { projetarParaClaude } from '../../cordel/alicerce/pastas-por-ia.ts'
import { OllamaProvider } from './ollama.ts'
import { ambienteClaudeOllama, argumentosClaudeOllama, baseOllamaLocal, configuradoOllama, modeloOllama, recusaDoModeloLocal } from './backend-ollama.ts'
import { claudeArgv, CLAUDE_MODOS } from './claude-argv.ts'
import { claudeAutenticado, planoDoClaude, planoLocal } from '../../euclides/tesouro/planos.ts'
export { agentsArgv, claudeArgv, toolsFor } from './claude-argv.ts'
import { run } from '../../quilombo/git.ts'
import { emptyUsage } from '../uso.ts'
import { COST_UNKNOWN, readReportedCost } from '../../euclides/tesouro/custo.ts'
import { runClaudeStream } from './claude-stream.ts'
import type { CostReading } from '../../euclides/tesouro/custo.ts'
import type { AgentRole, AgentRequest, AgentResult, CatalogoDeModo, CorDeMarca, Harness, HarnessCapabilities, HarnessId, PlanoDoProvedor, SinaisDoHarness } from '../tipos.ts'
import { cliSaudavel } from '../sonda.ts'
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
  emitsStructuredJson: true,
  restrictsTools: true,      // --allowedTools em toda chamada
  isolatesReadonly: true,    // modo readonly cai em Read,Glob,Grep
  acceptsEffort: true,       // --effort
  reportsCostUsd: true,      // total_cost_usd no JSON
  reportsTokens: true,
  mcp: true,                 // unico harness com extraTools ligado hoje
}

export const CLAUDE_SINAIS: SinaisDoHarness = {
  terminal: [{ pattern: /failed to authenticate|oauth session expired|could not be refreshed|not logged in/i, reason: 'credencial do Claude expirada ou ausente — rode `claude login` (ou /login no hii) e retome a tarefa' }],
  quota: [{ pattern: /claude ai usage limit reached|you'?ve hit your session limit|5-hour limit reached|weekly limit reached/i, reason: 'limite de uso da assinatura Claude atingido' }],
  transient: [{ pattern: /overloaded_error|\bapi_error\b/i, reason: 'erro transitorio da API Anthropic' }],
}

export class ClaudeProvider implements Harness {
  prepararProjeto(alvo: string): void { projetarParaClaude(alvo) }
  saidaIncremental(req: AgentRequest): boolean { return !!req.liveLog }
  readonly name: HarnessId
  readonly ollama: boolean
  readonly recursoDeInferencia?: Harness['recursoDeInferencia']
  readonly identidadeDeInferencia?: Harness['identidadeDeInferencia']
  private readonly servidorLocal = new OllamaProvider()
  constructor(ollama = false) {
    this.ollama = ollama
    this.name = ollama ? 'claude-ollama' : 'claude'
    if (ollama) {
      this.recursoDeInferencia = modelo => this.servidorLocal.recursoDeInferencia(modelo)
      this.identidadeDeInferencia = () => this.servidorLocal.identidadeDeInferencia()
    }
  }
  get inferenciaLocalVerificada(): boolean { return this.ollama && this.servidorLocal.inferenciaLocalVerificada }
  readonly supportsAgents = true
  get supportsVision(): boolean { return !this.ollama }
  readonly agentic = true

  readonly modos: CatalogoDeModo = CLAUDE_MODOS
  readonly cor: CorDeMarca = { r: 218, g: 119, b: 86 }
  readonly binario = 'claude'
  readonly exigeCliNoPath = true
  get comandoDeLogin(): readonly string[] { return this.ollama ? [] : ['claude', '/login'] }
  get rodaLocal(): boolean { return this.ollama }
  get temLeitorDePlano(): boolean { return !this.ollama }

  prontoParaUso(): boolean { return !this.ollama || (configuradoOllama('claude') && this.servidorLocal.prontoParaUso()) }
  // De proposito NAO le HII_CLAUDE_MODEL: o claude usa o modelo padrao do
  // proprio CLI fora de verify/gate, e era assim antes desta refatoracao.
  modeloPadraoPara(papel: AgentRole): string | undefined {
    if (this.ollama) return modeloOllama('claude')
    if (papel === 'verify') return VERIFY_MODEL
    if (papel === 'gate') return GATE_MODEL
    return undefined
  }
  comoObterQuandoAusente(): string { return this.ollama ? 'instale o CLI claude, inicie o Ollama local e configure HII_CLAUDE_OLLAMA_MODEL' : 'instale o CLI do Claude Code' }
  autenticado(): boolean { return this.ollama ? configuradoOllama('claude') : claudeAutenticado() }
  plano(agoraMs: number): PlanoDoProvedor { return this.ollama ? planoLocal(this.name) : planoDoClaude(agoraMs) }
  modelosDisponiveis(): string[] { return this.ollama ? this.servidorLocal.modelosDisponiveis() : this.plano(Date.now()).modelos }
  capabilities(): HarnessCapabilities { return this.ollama ? { ...CLAUDE_CAPACIDADES, reportsCostUsd: false, acceptsEffort: false } : CLAUDE_CAPACIDADES }
  healthCheck(): Promise<boolean> { return cliSaudavel(this.binario, this.ollama ? baseOllamaLocal() + '/api/tags' : URL_DA_API) }
  sinaisDeFalha(): SinaisDoHarness { return CLAUDE_SINAIS }

  async run(req: AgentRequest): Promise<AgentResult> {
    if (this.ollama) {
      const motivo = await recusaDoModeloLocal(req.model || modeloOllama('claude'))
      if (motivo) return { ok: false, failed: true, timedOut: false, isError: false, detail: motivo, text: '', ...COST_UNKNOWN, usage: emptyUsage() }
    }
    const ambiente = this.ollama ? ambienteClaudeOllama() : {}
    if (this.ollama) req = { ...req, model: req.model || modeloOllama('claude'), effort: undefined }
    if (req.liveLog) {
      const res = await runClaudeStream(req, req.liveLog, ambiente, this.ollama ? argumentosClaudeOllama() : [])
      return this.ollama ? { ...res, ...COST_UNKNOWN } : res
    }
    const { err, stdout, stderr } = await run('claude', [...claudeArgv(req), ...(this.ollama ? argumentosClaudeOllama() : [])], { cwd: req.cwd, env: ambiente, timeout: req.timeoutMs, aoIniciar: req.aoIniciar })
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
      ...(this.ollama ? COST_UNKNOWN : reading),
      usage,
    }
  }
}
