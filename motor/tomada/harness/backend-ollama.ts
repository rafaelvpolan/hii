import { totalmem } from 'node:os'
// Configuracao por subprocesso: nunca altera login nem preferencias globais.
import { isLoopbackHost } from '../../quilombo/alfandega/loopback.ts'

export function baseOllamaLocal(): string {
  const u = new URL(process.env.HII_OLLAMA_URL || 'http://localhost:11434')
  if (!['http:', 'https:'].includes(u.protocol) || !isLoopbackHost(u.hostname) || u.username || u.password || u.search || u.hash) {
    throw new Error('Este piloto aceita apenas Ollama local sem credenciais na URL; VPS ainda nao habilitado')
  }
  return u.toString().replace(/\/$/, '')
}

export function ambienteClaudeOllama(): NodeJS.ProcessEnv {
  return { ANTHROPIC_BASE_URL: baseOllamaLocal(), ANTHROPIC_AUTH_TOKEN: 'ollama', ANTHROPIC_API_KEY: '' }
}

export function modeloOllama(cli: 'claude' | 'codex'): string | undefined {
  return process.env[cli === 'claude' ? 'HII_CLAUDE_OLLAMA_MODEL' : 'HII_CODEX_OLLAMA_MODEL'] || process.env.HII_OLLAMA_MODEL || undefined
}

export function configuradoOllama(_cli: 'claude' | 'codex'): boolean {
  try { return !!baseOllamaLocal() } catch { return false }
}

export function argumentosClaudeOllama(): string[] {
  return ['--setting-sources', 'project,local', '--settings', JSON.stringify({ env: ambienteClaudeOllama() })]
}

interface ModeloLocal { name?: string; model?: string; size?: number; capabilities?: string[] }
interface CatalogoLocal { models?: ModeloLocal[] }

export function orcamentoDeMemoriaLocal(): number {
  const mb = Number(process.env.HII_OLLAMA_MEMORY_BUDGET_MB || '0')
  return Number.isFinite(mb) && mb > 0 ? mb * 1024 ** 2 : Math.floor(totalmem() * 0.8)
}

// Conservador: nao presume VRAM livre ou offload a partir de uma URL loopback.
export async function recusaDoModeloLocal(modelo: string | undefined): Promise<string> {
  if (!modelo) return 'Escolha o modelo Ollama da tarefa ou configure HII_CLAUDE_OLLAMA_MODEL/HII_CODEX_OLLAMA_MODEL antes de executar.'
  try {
    const resposta = await fetch(baseOllamaLocal() + '/api/tags', { signal: AbortSignal.timeout(5000) })
    if (!resposta.ok) return 'Ollama local nao disponibilizou o catalogo de modelos; nenhuma inferencia iniciada.'
    const catalogo = await resposta.json() as CatalogoLocal
    const escolhido = catalogo.models?.find(m => m.name === modelo || m.model === modelo || m.name === modelo + ':latest')
    if (!escolhido) return `Modelo ${modelo} nao instalado no Ollama local; escolha um modelo do catalogo antes de executar.`
    const teto = orcamentoDeMemoriaLocal()
    if (typeof escolhido.size !== 'number' || !Number.isFinite(escolhido.size) || escolhido.size <= 0) return 'Tamanho do modelo desconhecido; nao foi possivel validar o orcamento de memoria local.'
    if (escolhido.size > teto) {
      const alternativas = (catalogo.models ?? []).filter(m => typeof m.size === 'number' && m.size > 0 && m.size <= teto && m.capabilities?.includes('tools'))
      return `Modelo ${modelo} excede o orcamento de memoria local (${Math.ceil(escolhido.size / 1024 ** 2)} MB > ${Math.floor(teto / 1024 ** 2)} MB). ${alternativas.length ? 'Alternativas instaladas: ' + alternativas.map(m => m.name || m.model).join(', ') + '. Escolha explicitamente outro modelo e revise o pacote.' : 'Nenhum modelo de ferramentas compativel com este teto foi identificado.'} Aumente HII_OLLAMA_MEMORY_BUDGET_MB somente se os recursos locais comportarem o modelo; nenhuma troca automatica realizada.`
    }
    return ''
  } catch (e) { return `Nao foi possivel verificar o modelo Ollama local: ${String((e as Error).message)}; nenhuma inferencia iniciada.` }
}
