import { test, expect } from '../apoio/runner.ts'
import { argv } from '../../motor/tmd/harness/codex.ts'
import { claudeArgv } from '../../motor/tmd/harness/claude-argv.ts'
import { kimiArgv } from '../../motor/tmd/harness/kimi.ts'
import { modosDoProvedor } from '../../motor/tmd/modos.ts'
import type { AgentMode, AgentRequest } from '../../motor/tmd/tipos.ts'

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

// O kimi e a excecao entre os provedores: em execucao unica (`-p`) ele nao aceita
// NENHUM flag de modo — medido contra o CLI 0.38.0, que aborta com "Cannot combine
// --prompt with --auto/--yolo/--plan". O catalogo dele tem um modo so por isso.
test('kimi: modo escolhido nao vira flag, porque o CLI recusa junto com -p', () => {
  for (const modo of [undefined, 'auto', 'plan', 'yolo']) {
    const a = kimiArgv(pedido('edit', modo ? { modo } : {}))
    for (const flag of ['--auto', '--plan', '--yolo']) expect(a, `${modo ?? 'sem modo'} / ${flag}`).not.toContain(flag)
  }
  expect(modosDoProvedor('kimi')).toEqual(['default'])
})

test('REGRESSAO nenhum catalogo oferece modo que dispensa aprovacao no claude', () => {
  expect(modosDoProvedor('claude')).not.toContain('bypassPermissions')
  expect(modosDoProvedor('claude')).not.toContain('dontAsk')
})
