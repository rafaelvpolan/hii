import { test, expect } from '../apoio/runner.ts'
import { definirEstadoDoOllama, sondarOllama } from '../../motor/tomada/harness/ollama-estado.ts'
import { OllamaProvider } from '../../motor/tomada/harness/ollama.ts'

test('descoberta preserva versao e digest com origem e endpoint sem credencial', async () => {
  const anterior = globalThis.fetch
  const urlAnterior = process.env.HII_OLLAMA_URL
  process.env.HII_OLLAMA_URL = 'http://usuario:segredo@127.0.0.1:11434'
  globalThis.fetch = (async (entrada: string | URL | Request) => {
    const url = String(entrada)
    return new Response(JSON.stringify(url.endsWith('/api/tags')
      ? { models: [{ name: 'qwen:7b', digest: 'sha256:abc' }] }
      : url.endsWith('/api/ps')
        ? { models: [{ name: 'qwen:7b', size_vram: 4_000_000_000, size: 5_000_000_000, expires_at: '2026-09-24T18:00:00Z' }] }
        : { version: '0.12.3' }), { status: 200 })
  }) as typeof fetch
  try {
    const estado = await sondarOllama(1234)
    definirEstadoDoOllama(estado)
    expect(estado).toMatchObject({ habilitado: true, modelos: ['qwen:7b'], versao: '0.12.3', verificadoEm: 1234 })
    expect(new OllamaProvider().identidadeDeInferencia()).toEqual({ endpoint: 'http://127.0.0.1:11434', versao: '0.12.3', verificadoEm: 1234,
      origem: 'servidor', modelos: [{ nome: 'qwen:7b', digest: 'sha256:abc' }],
      carga: [{ nome: 'qwen:7b', sizeVram: 4_000_000_000, tamanho: 5_000_000_000, expiraEm: '2026-09-24T18:00:00Z' }], memoriaLivre: null })
  } finally {
    globalThis.fetch = anterior
    if (urlAnterior === undefined) delete process.env.HII_OLLAMA_URL; else process.env.HII_OLLAMA_URL = urlAnterior
    definirEstadoDoOllama({ habilitado: false, modelos: [], verificadoEm: 0 })
  }
})
