const TTL_MS = 5000
const TIMEOUT_MS = 400

export interface EstadoDoOllama {
  habilitado: boolean
  modelos: string[]
  identidades?: { nome: string; digest: string | null }[]
  versao?: string | null
  verificadoEm: number
}

let cache: EstadoDoOllama = { habilitado: false, modelos: [], verificadoEm: 0 }
let emVoo = false

export function urlDoOllama(): string {
  return process.env.HII_OLLAMA_URL || 'http://127.0.0.1:11434'
}

interface TagsDoOllama {
  models?: { name?: string; digest?: string }[]
}
interface VersaoDoOllama { version?: string }

export async function sondarOllama(agoraMs: number = Date.now()): Promise<EstadoDoOllama> {
  try {
    const r = await fetch(`${urlDoOllama()}/api/tags`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!r.ok) return { habilitado: false, modelos: [], verificadoEm: agoraMs }
    const j = (await r.json()) as TagsDoOllama
    const identidades = (j.models ?? []).filter(m => typeof m.name === 'string' && m.name).map(m => ({ nome: m.name!, digest: typeof m.digest === 'string' && m.digest ? m.digest : null }))
    let versao: string | null = null
    try {
      const rv = await fetch(`${urlDoOllama()}/api/version`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (rv.ok) { const v = await rv.json() as VersaoDoOllama; versao = typeof v.version === 'string' ? v.version : null }
    } catch { /* tags ainda comprovam que o servidor esta vivo */ }
    return { habilitado: true, modelos: identidades.map(m => m.nome), identidades, versao, verificadoEm: agoraMs }
  } catch {
    return { habilitado: false, modelos: [], verificadoEm: agoraMs }
  }
}

export function estadoDoOllama(agoraMs: number = Date.now()): EstadoDoOllama {
  if (!emVoo && agoraMs - cache.verificadoEm > TTL_MS) {
    emVoo = true
    void sondarOllama(agoraMs).then(novo => { cache = novo }).finally(() => { emVoo = false })
  }
  return cache
}

export function definirEstadoDoOllama(novo: EstadoDoOllama): void {
  cache = novo
}
