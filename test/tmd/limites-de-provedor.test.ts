import { test, expect } from 'bun:test'
import { recusaPorLimite } from '../../motor/euc/tsr/confianca.ts'
import { KimiProvider } from '../../motor/tmd/harness/kimi.ts'
import { ClaudeProvider } from '../../motor/tmd/harness/claude.ts'
import type { AgentRequest } from '../../motor/tmd/tipos.ts'

const pedido = (mode: AgentRequest['mode']): AgentRequest => ({
  prompt: 'x', cwd: '/tmp', dirs: [], mode, useAgents: false, timeoutMs: 1000,
})

test('kimi e RECUSADO em modo somente-leitura — nao restringe ferramenta', () => {
  const r = recusaPorLimite(new KimiProvider(), pedido('readonly'))
  expect(r).toContain('somente-leitura')
  expect(r).toContain('kimi')
})

test('kimi passa em modo de edicao', () => {
  expect(recusaPorLimite(new KimiProvider(), pedido('edit'))).toBe('')
})

test('claude passa nos dois modos', () => {
  expect(recusaPorLimite(new ClaudeProvider(), pedido('readonly'))).toBe('')
  expect(recusaPorLimite(new ClaudeProvider(), pedido('edit'))).toBe('')
})

// Medido contra o CLI real (0.38.0): `-p --auto` aborta com "Cannot combine
// --prompt with --auto" antes de tocar em arquivo. A afirmacao anterior deste teste
// era o oposto da realidade e passava porque nunca executou o binario.
test('kimi em modo de edicao NAO passa flag de modo — o CLI recusa junto com -p', async () => {
  const { kimiArgv } = await import('../../motor/tmd/harness/kimi.ts')
  for (const flag of ['--auto', '--yolo', '--plan']) {
    expect(kimiArgv(pedido('edit')), flag).not.toContain(flag)
  }
})

test('kimi nunca recebe flag que o CLI dele nao tem', async () => {
  const { kimiArgv } = await import('../../motor/tmd/harness/kimi.ts')
  const argv = kimiArgv({ ...pedido('edit'), effort: 'high', model: 'kimi-for-coding' }).join(' ')
  expect(argv).not.toContain('--allowedTools')
  expect(argv).not.toContain('--effort')
  expect(argv).not.toContain('--permission-mode')
  expect(argv).toContain('-m kimi-for-coding')
})
