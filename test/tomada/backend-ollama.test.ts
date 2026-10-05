import { test, expect, afterEach } from '../apoio/runner.ts'
import { ambienteClaudeOllama, baseOllamaLocal } from '../../motor/tomada/harness/backend-ollama.ts'
import { argv } from '../../motor/tomada/harness/codex.ts'
import { claudeArgv } from '../../motor/tomada/harness/claude-argv.ts'
import { harnessPorNome } from '../../motor/tomada/registro.ts'
import type { AgentRequest } from '../../motor/tomada/tipos.ts'
const req: AgentRequest = { prompt: 'teste local', cwd: '/tmp', dirs: ['/tmp'], mode: 'readonly', useAgents: false, timeoutMs: 1000, model: 'modelo-local' }
const originalUrl = process.env.HII_OLLAMA_URL
afterEach(() => { if (originalUrl === undefined) delete process.env.HII_OLLAMA_URL; else process.env.HII_OLLAMA_URL = originalUrl })
test('Codex Ollama usa OSS explicitamente sem modificar chamada nativa', () => {
  expect(argv(req, '/tmp', true)).toContain('--oss')
  expect(argv(req, '/tmp', true)).toContain('--local-provider')
  expect(argv(req, '/tmp')).not.toContain('--oss')
  expect(argv(req, '/tmp', true)).toContain('read-only')
})
test('Claude Ollama isola credenciais no subprocesso', () => {
  process.env.HII_OLLAMA_URL = 'http://127.0.0.1:11434'
  const antes = process.env.ANTHROPIC_AUTH_TOKEN
  expect(ambienteClaudeOllama().ANTHROPIC_AUTH_TOKEN).toBe('ollama')
  expect(ambienteClaudeOllama().ANTHROPIC_API_KEY).toBe('')
  expect(process.env.ANTHROPIC_AUTH_TOKEN).toBe(antes)
})
test('piloto rejeita VPS e URLs com credenciais', () => {
  for (const url of ['https://vps.example.com', 'http://user:password@localhost:11434', 'file:///tmp/ollama']) {
    process.env.HII_OLLAMA_URL = url
    expect(() => baseOllamaLocal()).toThrow()
  }
})
test('Claude recebe saldo nativo para impedir novas chamadas alem do orcamento', () => {
  expect(claudeArgv({ ...req, maxBudgetUsd: 0.75 })).toContain('--max-budget-usd')
  expect(claudeArgv({ ...req, maxBudgetUsd: 0.75 })).toContain('0.75')
  expect(claudeArgv(req)).not.toContain('--max-budget-usd')
})
test('adaptadores locais estao no registro e mantem isolamento de leitura', () => {
  for (const nome of ['claude-ollama', 'codex-ollama']) {
    const h = harnessPorNome(nome)
    expect(h.rodaLocal).toBe(true)
    expect(h.capabilities().isolatesReadonly).toBe(true)
    expect(h.capabilities().reportsCostUsd).toBe(false)
  }
})

test('Claude e Codex locais compartilham os mesmos slots do servidor Ollama', () => {
  const claude = harnessPorNome('claude-ollama').recursoDeInferencia?.('modelo-local')
  const codex = harnessPorNome('codex-ollama').recursoDeInferencia?.('modelo-local')
  expect(claude).toEqual(codex)
  expect(claude?.servidor).toContain('localhost')
  expect(claude?.slotsServidor).toBe(1)
  expect(harnessPorNome('claude').recursoDeInferencia).toBeUndefined()
  expect(harnessPorNome('codex').recursoDeInferencia).toBeUndefined()
})
