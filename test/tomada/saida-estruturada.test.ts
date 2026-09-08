// Onda 1-D do raio-x: papel que faz JSON.parse do veredito declara `expectsJson`
// na requisicao, e harness que nao emite JSON estruturado e RECUSADO antes de
// gastar — `/ia gate ollama` trocava HALT-por-card silencioso (7-8B local nao
// cumpre o schema do veredito) por recusa clara com instrucao de conserto.
import { test, expect } from '../apoio/runner.ts'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

process.env.HICODE_CARDS_DIR = mkdtempSync(join(tmpdir(), 'hicode-json-'))

const { harnessPorNome } = await import('../../motor/tomada/registro.ts')
const { recusaPorLimite, runProvider } = await import('../../motor/euclides/tesouro/confianca.ts')
const { SEM_PLANO } = await import('../../motor/tomada/tipos.ts')

type Harness = import('../../motor/tomada/tipos.ts').Harness
type AgentRequest = import('../../motor/tomada/tipos.ts').AgentRequest

function req(extra: Partial<AgentRequest>): AgentRequest {
  return { prompt: 'p', cwd: '/tmp', dirs: [], mode: 'readonly', useAgents: false, timeoutMs: 1000, ...extra }
}

test('ollama com expectsJson e recusado ANTES de gastar, com o conserto na mensagem', () => {
  const recusa = recusaPorLimite(harnessPorNome('ollama'), req({ expectsJson: true }))
  expect(recusa).toContain('JSON')
  expect(recusa).toContain('ollama')
  expect(recusa).toContain('/ia gate')
})

test('ollama SEM expectsJson segue aceito em readonly — rascunho e classificacao continuam valendo', () => {
  expect(recusaPorLimite(harnessPorNome('ollama'), req({}))).toBe('')
})

test('claude e codex declaram JSON estruturado e passam com expectsJson', () => {
  expect(recusaPorLimite(harnessPorNome('claude'), req({ expectsJson: true }))).toBe('')
  expect(recusaPorLimite(harnessPorNome('codex'), req({ expectsJson: true }))).toBe('')
})

test('a guarda de somente-leitura vem ANTES: kimi em readonly recusa por isolamento, nao por JSON', () => {
  const recusa = recusaPorLimite(harnessPorNome('kimi'), req({ expectsJson: true }))
  expect(recusa).toContain('somente-leitura')
})

test('runProvider devolve failed com a recusa e NAO chama o run do harness', async () => {
  let chamouRun = false
  const falso: Harness = {
    name: 'falso-sem-json',
    supportsAgents: false,
    supportsVision: false,
    agentic: false,
    modos: { modos: [], padrao: '' },
    cor: { r: 0, g: 0, b: 0 },
    binario: 'falso',
    exigeCliNoPath: false,
    comandoDeLogin: [],
    temLeitorDePlano: false,
    rodaLocal: true,
    capabilities: () => ({ restrictsTools: false, isolatesReadonly: true, acceptsEffort: false, reportsCostUsd: true, reportsTokens: true, mcp: false, emitsStructuredJson: false }),
    healthCheck: async () => true,
    sinaisDeFalha: () => ({ terminal: [], quota: [], transient: [] }),
    comoObterQuandoAusente: () => '',
    autenticado: () => true,
    plano: () => SEM_PLANO,
    modelosDisponiveis: () => [],
    prontoParaUso: () => true,
    modeloPadraoPara: () => undefined,
    run: async () => {
      chamouRun = true
      throw new Error('nao deveria rodar')
    },
  }
  const res = await runProvider('', falso, req({ expectsJson: true }))
  expect(res.failed).toBe(true)
  expect(res.detail).toContain('JSON')
  expect(chamouRun).toBe(false)
})
