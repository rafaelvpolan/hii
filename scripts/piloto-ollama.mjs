import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OllamaProvider } from '../motor/tomada/harness/ollama.ts'
import { sondarOllama } from '../motor/tomada/harness/ollama-estado.ts'

if (process.env.HII_OLLAMA_PILOT !== '1') throw new Error('piloto opt-in: defina HII_OLLAMA_PILOT=1')
process.env.HII_OLLAMA_AGENTIC = '1'
const modelo = process.env.HII_OLLAMA_MODEL || 'qwen2.5-coder:7b'
const dir = mkdtempSync(join(tmpdir(), 'hii-ollama-piloto-'))
const arquivo = join(dir, 'fixture.txt')
writeFileSync(arquivo, 'estado=antes\n')
const eventos = []
const inicio = performance.now()
try {
  const estado = await sondarOllama()
  if (!estado.habilitado || !estado.modelos.includes(modelo)) throw new Error(`modelo ${modelo} nao esta instalado`)
  const resultado = await new OllamaProvider().run({
    prompt: 'Use read_file em fixture.txt e depois replace_text para trocar exatamente estado=antes por estado=depois. Finalize com uma resposta curta.',
    cwd: dir, dirs: [dir], mode: 'edit', useAgents: false, model: modelo, timeoutMs: 180000,
    aoEvento: evento => eventos.push(evento.tipo),
  })
  const depois = readFileSync(arquivo, 'utf8')
  const identidade = estado.identidades?.find(item => item.nome === modelo)
  const relatorio = { ok: resultado.ok && depois === 'estado=depois\n', servidor: estado.versao ?? null, modelo,
    digest: identidade?.digest ?? null, duracaoMs: Math.round(performance.now() - inicio), tokens: resultado.usage,
    eventos, arquivo: depois.trim(), resposta: resultado.text.slice(0, 500), detalhe: resultado.detail }
  process.stdout.write(JSON.stringify(relatorio, null, 2) + '\n')
  if (!relatorio.ok) process.exitCode = 1
} finally { rmSync(dir, { recursive: true, force: true }) }
