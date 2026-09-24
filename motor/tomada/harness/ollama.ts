import { run } from '../../quilombo/git.ts'
import { isLoopbackHost, noProxyArgs } from '../../quilombo/alfandega/loopback.ts'
import { emptyUsage } from '../uso.ts'
import { COST_FREE_LOCAL, COST_UNKNOWN } from '../../euclides/tesouro/custo.ts'
import type { CostReading } from '../../euclides/tesouro/custo.ts'
import type { AgentRequest, AgentResult, CatalogoDeModo, CorDeMarca, Harness, HarnessCapabilities, HarnessId, PlanoDoProvedor, SinaisDoHarness } from '../tipos.ts'
import { planoLocal } from '../../euclides/tesouro/planos.ts'
import { estadoDoOllama } from './ollama-estado.ts'
import { alcancavelPorHttp, urlDoOllama } from '../sonda.ts'
import { gravarChamadaNoLiveLog } from './live-log.ts'
import { executarFerramentaOllama, FERRAMENTAS_OLLAMA } from './ollama-ferramentas.ts'
import type { ChamadaDeFerramentaOllama } from './ollama-ferramentas.ts'
import { numeroDeEnv } from '../../cordel/alicerce/config.ts'

interface OllamaResponse {
  response?: string
  error?: string
  prompt_eval_count?: number
  eval_count?: number
  capabilities?: string[]
  message?: { role?: string; content?: string; tool_calls?: ChamadaDeFerramentaOllama[] }
}

function baseUrl(): string {
  return process.env.HII_OLLAMA_URL || 'http://localhost:11434'
}

function endpointIdentificado(): string {
  try {
    const u = new URL(baseUrl())
    u.username = ''; u.password = ''; u.search = ''; u.hash = ''
    return u.toString().replace(/\/$/, '')
  } catch { return 'ollama:endpoint-invalido' }
}

function endpointRodaNesteHost(): boolean {
  try {
    return isLoopbackHost(new URL(baseUrl()).hostname)
  } catch {
    return false
  }
}

function costOfEndpoint(): CostReading {
  return endpointRodaNesteHost() ? COST_FREE_LOCAL : COST_UNKNOWN
}

const CAPACIDADES_SIMPLES: HarnessCapabilities = {
  emitsStructuredJson: false,
  restrictsTools: false,     // nao ha mecanismo de ferramenta pra restringir
  isolatesReadonly: true,    // ...e por isso mesmo nao consegue editar nada
  acceptsEffort: false,
  reportsCostUsd: true,      // COST_FREE_LOCAL: zero medido, quando o endpoint e local
  reportsTokens: true,       // prompt_eval_count / eval_count
  mcp: false,
}

function agentivoLigado(): boolean { return process.env.HII_OLLAMA_AGENTIC === '1' }

export function capacidadesDoOllama(agentivo = agentivoLigado()): HarnessCapabilities {
  return agentivo ? { ...CAPACIDADES_SIMPLES, restrictsTools: true, isolatesReadonly: true } : CAPACIDADES_SIMPLES
}

export const OLLAMA_CAPACIDADES: HarnessCapabilities = CAPACIDADES_SIMPLES

export const OLLAMA_SINAIS: SinaisDoHarness = {
  terminal: [{ pattern: /model not found|no such model/i, reason: 'modelo ollama nao encontrado localmente' }],
  quota: [],
  transient: [{ pattern: /connection refused/i, reason: 'ollama nao esta respondendo (servidor local fora do ar)' }],
}

export class OllamaProvider implements Harness {
  readonly name: HarnessId = 'ollama'
  readonly supportsAgents = false
  readonly supportsVision = false
  readonly agentic = agentivoLigado()

  readonly modos: CatalogoDeModo = { modos: [], padrao: '' }
  readonly cor: CorDeMarca = { r: 148, g: 163, b: 184 }
  readonly binario = 'ollama'
  // Roda como servidor local: o doctor nao cobra `ollama --version` no PATH.
  readonly exigeCliNoPath = false
  readonly comandoDeLogin: readonly string[] = []
  readonly rodaLocal = true
  get inferenciaLocalVerificada(): boolean {
    return endpointRodaNesteHost() && process.env.HII_OLLAMA_LOCALITY_VERIFIED === '1'
  }
  readonly temLeitorDePlano = true
  recursoDeInferencia(modelo: string | undefined): { servidor: string; modelo: string; slotsServidor: number; slotsModelo: number } {
    return { servidor: endpointIdentificado(), modelo: modelo || this.modeloPadraoPara() || 'llama3.1',
      slotsServidor: Math.floor(numeroDeEnv('HII_OLLAMA_MAX_INFLIGHT', 1)),
      slotsModelo: Math.floor(numeroDeEnv('HII_OLLAMA_MODEL_MAX_INFLIGHT', 1)) }
  }

  // Unico harness cuja prontidao depende de um servidor local estar de pe.
  modeloPadraoPara(): string | undefined { return process.env.HII_OLLAMA_MODEL || undefined }
  prontoParaUso(): boolean { return estadoDoOllama().habilitado }
  comoObterQuandoAusente(): string { return `suba o ollama (${process.env.HII_OLLAMA_URL || 'http://localhost:11434'})` }
  autenticado(): boolean { return true }
  plano(): PlanoDoProvedor { return planoLocal('ollama') }
  // Unico harness que descobre modelo ao vivo, sondando o servidor local.
  modelosDisponiveis(): string[] { return estadoDoOllama().modelos }
  capabilities(): HarnessCapabilities { return capacidadesDoOllama(this.agentic) }
  healthCheck(): Promise<boolean> { return alcancavelPorHttp(urlDoOllama()) }
  sinaisDeFalha(): SinaisDoHarness { return OLLAMA_SINAIS }

  async run(req: AgentRequest): Promise<AgentResult> {
    const model = req.model || process.env.HII_OLLAMA_MODEL || 'llama3.1'
    if (this.agentic) return this.runAgentivo(req, model)
    const body = JSON.stringify({ model, prompt: req.prompt, stream: false })
    const endpoint = `${baseUrl()}/api/generate`
    const args = ['-q', ...noProxyArgs(endpoint), '-sS', '--fail-with-body', '-H', 'Content-Type: application/json', endpoint, '-d', body]
    const { err, stdout } = await run('curl', args, { cwd: req.cwd, timeout: req.timeoutMs, aoIniciar: req.aoIniciar })
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
      if (!j || typeof j !== 'object' || Array.isArray(j) || (typeof j.response !== 'string' && typeof j.error !== 'string')) throw new Error('resposta Ollama invalida')
      text = String(j.response ?? '')
      usage.tokens_in = Number.isSafeInteger(j.prompt_eval_count) && Number(j.prompt_eval_count) >= 0 ? Number(j.prompt_eval_count) : 0
      usage.tokens_out = Number.isSafeInteger(j.eval_count) && Number(j.eval_count) >= 0 ? Number(j.eval_count) : 0
      if (j.error) {
        isError = true
        erroDoCorpo = String(j.error)
        if (!text) text = erroDoCorpo
      }
    } catch {
      isError = true
      erroDoCorpo = 'Ollama respondeu sem um documento de geracao valido'
      text = erroDoCorpo
    }
    const failed = !!err
    if (!failed && !isError && text) {
      try { req.aoEmitir?.('assistant', text) } catch { /* observador isolado */ }
    }
    if (req.liveLog) gravarChamadaNoLiveLog({ caminho: req.liveLog, rotulo: req.rotulo, raia: req.raia, linhas: text ? text.split('\n') : [], custoUsd: costOfEndpoint().cost })
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

  private async runAgentivo(req: AgentRequest, model: string): Promise<AgentResult> {
    const inicio = Date.now()
    const usage = emptyUsage()
    const custo = costOfEndpoint()
    const chamar = async (rota: string, corpo: object): Promise<{ erro: Error | null; json: OllamaResponse | null }> => {
      const endpoint = `${baseUrl()}${rota}`
      const restante = Math.max(1, req.timeoutMs - (Date.now() - inicio))
      const args = ['-q', ...noProxyArgs(endpoint), '-sS', '--fail-with-body', '-H', 'Content-Type: application/json', endpoint, '-d', JSON.stringify(corpo)]
      const { err, stdout } = await run('curl', args, { cwd: req.cwd, timeout: restante, aoIniciar: req.aoIniciar })
      if (err) return { erro: err, json: null }
      try {
        const json = JSON.parse(stdout) as OllamaResponse
        if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('JSON invalido')
        return { erro: null, json }
      } catch { return { erro: new Error('Ollama respondeu sem documento JSON valido'), json: null } }
    }
    const falhar = (detalhe: string, timedOut = false): AgentResult => ({ ok: false, failed: true, timedOut, isError: true, detail: detalhe, text: detalhe, ...custo, usage })
    const cancelada = (): AgentResult | null => req.cancelado?.() ? falhar('execucao cancelada pelo operador; nenhuma nova inferencia ou ferramenta iniciada') : null
    const antesDaSonda = cancelada()
    if (antesDaSonda) return antesDaSonda
    const sonda = await chamar('/api/show', { model })
    if (sonda.erro || !sonda.json) return falhar(sonda.erro?.message || 'falha ao consultar capacidade do modelo', !!(sonda.erro as { killed?: boolean } | null)?.killed)
    if (!Array.isArray(sonda.json.capabilities) || !sonda.json.capabilities.includes('tools')) return falhar(`modelo ${model} nao declara capacidade tools; nenhuma ferramenta foi executada`)
    try { req.aoEvento?.({ tipo: 'modelo_verificado' }) } catch { /* observador isolado */ }

    const mensagens: object[] = [{ role: 'user', content: req.prompt }]
    const repeticoes = new Map<string, number>()
    for (let turno = 0, chamadas = 0; turno < 16; turno++) {
      const antesDaInferencia = cancelada()
      if (antesDaInferencia) return antesDaInferencia
      try { req.aoEvento?.({ tipo: 'inferencia_inicio' }) } catch { /* observador isolado */ }
      const resposta = await chamar('/api/chat', { model, stream: false, messages: mensagens, tools: FERRAMENTAS_OLLAMA })
      try { req.aoEvento?.({ tipo: 'inferencia_fim' }) } catch { /* observador isolado */ }
      const depoisDaInferencia = cancelada()
      if (depoisDaInferencia) return depoisDaInferencia
      if (resposta.erro || !resposta.json) return falhar(resposta.erro?.message || 'falha na conversa Ollama', !!(resposta.erro as { killed?: boolean } | null)?.killed)
      usage.tokens_in += Number.isSafeInteger(resposta.json.prompt_eval_count) ? Number(resposta.json.prompt_eval_count) : 0
      usage.tokens_out += Number.isSafeInteger(resposta.json.eval_count) ? Number(resposta.json.eval_count) : 0
      if (resposta.json.error) return falhar(String(resposta.json.error))
      const mensagem = resposta.json.message
      if (!mensagem || typeof mensagem.content !== 'string' || (mensagem.tool_calls !== undefined && !Array.isArray(mensagem.tool_calls))) return falhar('Ollama respondeu sem mensagem valida')
      mensagens.push({ role: 'assistant', content: mensagem.content, tool_calls: mensagem.tool_calls })
      if (!mensagem.tool_calls?.length) {
        if (!mensagem.content) return falhar('Ollama encerrou sem resposta final')
        try { req.aoEmitir?.('assistant', mensagem.content) } catch { /* observador isolado */ }
        if (req.liveLog) gravarChamadaNoLiveLog({ caminho: req.liveLog, rotulo: req.rotulo, raia: req.raia, linhas: mensagem.content.split('\n'), custoUsd: custo.cost })
        return { ok: true, failed: false, timedOut: false, isError: false, detail: '', text: mensagem.content, ...custo, usage }
      }
      for (const ferramenta of mensagem.tool_calls) {
        const antesDaFerramenta = cancelada()
        if (antesDaFerramenta) return antesDaFerramenta
        if (++chamadas > 16) return falhar('limite de 16 chamadas de ferramenta excedido')
        const assinatura = JSON.stringify(ferramenta)
        const repetida = (repeticoes.get(assinatura) ?? 0) + 1
        repeticoes.set(assinatura, repetida)
        if (repetida > 2) return falhar('ferramenta repetida sem progresso')
        let conteudo: string
        const nome = ferramenta.function?.name || 'desconhecida'
        try { req.aoEvento?.({ tipo: 'ferramenta_inicio', ferramenta: nome }) } catch { /* observador isolado */ }
        try { conteudo = executarFerramentaOllama(ferramenta, req.cwd, req.dirs, req.mode) }
        catch (erro) { return falhar((erro as Error).message) }
        try { req.aoEvento?.({ tipo: 'ferramenta_fim', ferramenta: nome }) } catch { /* observador isolado */ }
        const depoisDaFerramenta = cancelada()
        if (depoisDaFerramenta) return depoisDaFerramenta
        mensagens.push({ role: 'tool', tool_name: ferramenta.function?.name, content: conteudo.slice(0, 64 * 1024) })
      }
    }
    return falhar('limite de 16 turnos do loop agentivo excedido')
  }
}
