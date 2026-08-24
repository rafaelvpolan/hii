import { run } from '../../qlb/git.ts'
import { isPrivateNetworkHost } from '../../qlb/alf/rede-privada.ts'
import { noProxyArgs } from '../../qlb/alf/loopback.ts'
import { emptyUsage } from '../uso.ts'
import { COST_FREE_LOCAL, COST_UNKNOWN } from '../../euc/tsr/custo.ts'
import type { CostReading } from '../../euc/tsr/custo.ts'
import type { AgentRequest, AgentResult, CatalogoDeModo, CorDeMarca, Harness, HarnessCapabilities, HarnessId, PlanoDoProvedor, SinaisDoHarness } from '../tipos.ts'
import { planoLocal } from '../../euc/tsr/planos.ts'
import { estadoDoOllama } from './ollama-estado.ts'
import { alcancavelPorHttp, urlDoOllama } from '../sonda.ts'

interface OllamaResponse {
  response?: string
  error?: string
  prompt_eval_count?: number
  eval_count?: number
}

function baseUrl(): string {
  return process.env.HICODE_OLLAMA_URL || 'http://localhost:11434'
}

function endpointRodaNaRedeLocal(): boolean {
  try {
    return isPrivateNetworkHost(new URL(baseUrl()).hostname)
  } catch {
    return false
  }
}

function costOfEndpoint(): CostReading {
  return endpointRodaNaRedeLocal() ? COST_FREE_LOCAL : COST_UNKNOWN
}

export const OLLAMA_CAPACIDADES: HarnessCapabilities = {
  restrictsTools: false,     // nao ha mecanismo de ferramenta pra restringir
  isolatesReadonly: true,    // ...e por isso mesmo nao consegue editar nada
  acceptsEffort: false,
  reportsCostUsd: true,      // COST_FREE_LOCAL: zero medido, quando o endpoint e local
  reportsTokens: true,       // prompt_eval_count / eval_count
  mcp: false,
}

export const OLLAMA_SINAIS: SinaisDoHarness = {
  terminal: [{ pattern: /model not found|no such model/i, reason: 'modelo ollama nao encontrado localmente' }],
  quota: [],
  transient: [{ pattern: /connection refused/i, reason: 'ollama nao esta respondendo (servidor local fora do ar)' }],
}

export class OllamaProvider implements Harness {
  readonly name: HarnessId = 'ollama'
  readonly supportsAgents = false
  readonly supportsVision = false
  readonly agentic = false

  readonly modos: CatalogoDeModo = { modos: [], padrao: '' }
  readonly cor: CorDeMarca = { r: 148, g: 163, b: 184 }
  readonly binario = 'ollama'
  // Roda como servidor local: o doctor nao cobra `ollama --version` no PATH.
  readonly exigeCliNoPath = false
  readonly comandoDeLogin: readonly string[] = []
  readonly rodaLocal = true
  readonly temLeitorDePlano = true

  // Unico harness cuja prontidao depende de um servidor local estar de pe.
  modeloPadraoPara(): string | undefined { return process.env.HICODE_OLLAMA_MODEL || undefined }
  prontoParaUso(): boolean { return estadoDoOllama().habilitado }
  comoObterQuandoAusente(): string { return `suba o ollama (${process.env.HICODE_OLLAMA_URL || 'http://localhost:11434'})` }
  autenticado(): boolean { return true }
  plano(): PlanoDoProvedor { return planoLocal('ollama') }
  // Unico harness que descobre modelo ao vivo, sondando o servidor local.
  modelosDisponiveis(): string[] { return estadoDoOllama().modelos }
  capabilities(): HarnessCapabilities { return OLLAMA_CAPACIDADES }
  healthCheck(): Promise<boolean> { return alcancavelPorHttp(urlDoOllama()) }
  sinaisDeFalha(): SinaisDoHarness { return OLLAMA_SINAIS }

  async run(req: AgentRequest): Promise<AgentResult> {
    const model = req.model || process.env.HICODE_OLLAMA_MODEL || 'llama3.1'
    const body = JSON.stringify({ model, prompt: req.prompt, stream: false })
    const endpoint = `${baseUrl()}/api/generate`
    const args = ['-q', ...noProxyArgs(endpoint), '-s', '-H', 'Content-Type: application/json', endpoint, '-d', body]
    const { err, stdout, stderr } = await run('curl', args, { cwd: req.cwd, timeout: req.timeoutMs })
    const usage = emptyUsage()
    let text = ''
    let isError = false
    // `j.error` carrega a MENSAGEM ("model not found", "connection refused"), e e
    // por ela que classifyFailure decide terminal/transitorio. Enquanto so o
    // booleano isError era guardado, o texto nunca chegava a `text` nem a
    // `detail`: OLLAMA_SINAIS.terminal era inalcancavel por construcao, e "modelo
    // que nao existe" era reclassificado como falha generica e reexecutado.
    let erroDoCorpo = ''
    try {
      const j = JSON.parse(stdout) as OllamaResponse
      text = String(j.response ?? '')
      usage.tokens_in = j.prompt_eval_count || 0
      usage.tokens_out = j.eval_count || 0
      if (j.error) {
        isError = true
        erroDoCorpo = String(j.error)
        if (!text) text = erroDoCorpo
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
      detail: [err ? String(err.message || '') : '', erroDoCorpo].filter(Boolean).join(' — '),
      text,
      ...costOfEndpoint(),
      usage,
    }
  }
}
