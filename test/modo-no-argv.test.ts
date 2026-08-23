import { test, expect } from 'bun:test'
import { argv } from '../motor/tmd/harness/codex'
import { claudeArgv } from '../motor/tmd/harness/claude-argv'
import { kimiArgv } from '../motor/tmd/harness/kimi'
import { modosDoProvedor } from '../motor/tmd/modos'
import type { AgentMode, AgentRequest } from '../motor/tmd/tipos'

function pedido(mode: AgentMode = 'edit', extra: Partial<AgentRequest> = {}): AgentRequest {
  return { prompt: 'faca algo', cwd: '/tmp/wt', dirs: ['/tmp/wt'], mode, useAgents: false, timeoutMs: 20000, ...extra }
}

function valorDepoisDe(lista: string[], flag: string): string {
  const i = lista.indexOf(flag)
  return i >= 0 ? (lista[i + 1] ?? '') : ''
}

test('codex: sem modo escolhido o argv mantem o padrao de hoje', () => {
  const a = argv(pedido(), '/tmp/wt')
  expect(a).toContain('-c')
  expect(a).toContain('approval_policy="never"')
})

test('codex: o modo escolhido chega ao approval_policy, e nao a outra flag', () => {
  for (const modo of modosDoProvedor('codex')) {
    const a = argv(pedido('edit', { modo }), '/tmp/wt')
    expect(a).toContain(`approval_policy="${modo}"`)
    expect(a.filter(x => x.startsWith('approval_policy='))).toHaveLength(1)
  }
})

test('codex: o modo nao contamina o sandbox, que segue vindo do mode', () => {
  expect(valorDepoisDe(argv(pedido('edit', { modo: 'untrusted' }), '/tmp/wt'), '--sandbox')).toBe('workspace-write')
  expect(valorDepoisDe(argv(pedido('readonly', { modo: 'never' }), '/tmp/wt'), '--sandbox')).toBe('read-only')
})

test('claude: o modo escolhido vira --permission-mode, e o padrao segue acceptEdits', () => {
  expect(valorDepoisDe(claudeArgv(pedido()), '--permission-mode')).toBe('acceptEdits')
  expect(valorDepoisDe(claudeArgv(pedido('edit', { modo: 'plan' })), '--permission-mode')).toBe('plan')
})

test('claude: readonly nao ganha --permission-mode nem com modo escolhido', () => {
  expect(claudeArgv(pedido('readonly', { modo: 'plan' }))).not.toContain('--permission-mode')
})

test('kimi: o modo escolhido troca a flag, e o padrao segue --auto', () => {
  expect(kimiArgv(pedido())).toContain('--auto')
  expect(kimiArgv(pedido('edit', { modo: 'plan' }))).toContain('--plan')
  expect(kimiArgv(pedido('edit', { modo: 'plan' }))).not.toContain('--auto')
})

test('REGRESSAO nenhum catalogo oferece modo que dispensa aprovacao no claude', () => {
  expect(modosDoProvedor('claude')).not.toContain('bypassPermissions')
  expect(modosDoProvedor('claude')).not.toContain('dontAsk')
})
