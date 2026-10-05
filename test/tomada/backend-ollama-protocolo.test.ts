import { test, expect, afterAll } from '../apoio/runner.ts'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeProvider } from '../../motor/tomada/harness/claude.ts'
import { CodexProvider } from '../../motor/tomada/harness/codex.ts'
import { recusaDoModeloLocal } from '../../motor/tomada/harness/backend-ollama.ts'
const dir = mkdtempSync(join(tmpdir(), 'hii-backend-protocolo-'))
const antes = { path: process.env.PATH, url: process.env.HII_OLLAMA_URL, memoria: process.env.HII_OLLAMA_MEMORY_BUDGET_MB }
const servidor = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ models: [{ name: 'pequeno', size: 1024, capabilities: ['tools'] }, { name: 'grande', size: 20 * 1024 ** 2, capabilities: ['tools'] }] }))
})
await new Promise<void>(resolve => servidor.listen(0, '127.0.0.1', resolve))
const endereco = servidor.address()
if (!endereco || typeof endereco === 'string') throw new Error('fixture sem porta')
process.env.HII_OLLAMA_URL = 'http://127.0.0.1:' + endereco.port
process.env.HII_OLLAMA_MEMORY_BUDGET_MB = '10'
process.env.PATH = dir + ':' + antes.path
for (const cli of ['claude', 'codex']) {
  const arquivo = join(dir, cli)
  writeFileSync(arquivo, '#!/usr/bin/env node\n' +
    'const fs = await import("node:fs"); fs.writeFileSync(' + JSON.stringify(join(dir, cli + '.json')) + ',JSON.stringify({argv:process.argv.slice(2),base:process.env.ANTHROPIC_BASE_URL,token:process.env.ANTHROPIC_AUTH_TOKEN,key:process.env.ANTHROPIC_API_KEY,ollama:process.env.OLLAMA_BASE_URL}));\n' +
    (cli === 'claude' ? 'console.log(JSON.stringify({result:"feito",total_cost_usd:0,usage:{input_tokens:2,output_tokens:3}}));\n' : 'console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"feito"}})); console.log(JSON.stringify({type:"turn.completed",usage:{input_tokens:2,output_tokens:3}}));\n'))
  chmodSync(arquivo, 0o755)
}
afterAll(async () => {
  await new Promise<void>(resolve => servidor.close(() => resolve()))
  if (antes.path === undefined) delete process.env.PATH; else process.env.PATH = antes.path
  if (antes.url === undefined) delete process.env.HII_OLLAMA_URL; else process.env.HII_OLLAMA_URL = antes.url
  if (antes.memoria === undefined) delete process.env.HII_OLLAMA_MEMORY_BUDGET_MB; else process.env.HII_OLLAMA_MEMORY_BUDGET_MB = antes.memoria
  rmSync(dir, { recursive: true, force: true })
})
const req = { prompt: 'fixture', cwd: dir, dirs: [dir], mode: 'readonly' as const, useAgents: false, model: 'pequeno', timeoutMs: 5000 }
test('Claude local valida catalogo e entrega ambiente e modelo apenas ao subprocesso', async () => {
  const antesToken = process.env.ANTHROPIC_AUTH_TOKEN
  const res = await new ClaudeProvider(true).run(req)
  expect(res.ok).toBe(true)
  expect(res.costMeasured).toBe(false)
  expect(res.usage.tokens_out).toBe(3)
  const chamado = JSON.parse(readFileSync(join(dir, 'claude.json'), 'utf8')) as { argv: string[]; base: string; token: string; key: string }
  expect(chamado.argv).toContain('pequeno')
  expect(chamado.argv).toContain('--settings')
  expect(chamado.base).toBe(process.env.HII_OLLAMA_URL)
  expect(chamado.token).toBe('ollama')
  expect(chamado.key).toBe('')
  expect(process.env.ANTHROPIC_AUTH_TOKEN).toBe(antesToken)
})
test('Codex local valida catalogo e seleciona explicitamente transporte OSS', async () => {
  const res = await new CodexProvider(true).run(req)
  expect(res.ok).toBe(true)
  const chamado = JSON.parse(readFileSync(join(dir, 'codex.json'), 'utf8')) as { argv: string[]; ollama: string }
  expect(chamado.argv).toContain('--oss')
  expect(chamado.argv).toContain('--local-provider')
  expect(chamado.argv).toContain('ollama')
  expect(chamado.ollama).toBe(process.env.HII_OLLAMA_URL)
})
test('modelo acima do teto e recusado antes de qualquer subprocesso e sem trocar sozinho', async () => {
  const arquivo = join(dir, 'codex.json')
  if (existsSync(arquivo)) rmSync(arquivo)
  const res = await new CodexProvider(true).run({ ...req, model: 'grande' })
  expect(res.ok).toBe(false)
  expect(res.detail).toContain('Alternativas instaladas: pequeno')
  expect(existsSync(arquivo)).toBe(false)
})
test('modelo ausente ou desconhecido nao inicia inferencia', async () => {
  expect(await recusaDoModeloLocal(undefined)).toContain('Escolha o modelo')
  expect(await recusaDoModeloLocal('nao-instalado')).toContain('nao instalado')
})
