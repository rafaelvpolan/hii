import { test, expect } from '../apoio/runner.ts'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bloqueia, checarDependencias, checarIa, preflight } from '../../motor/mir/cli/preflight.ts'
import type { ChecagemDeAmbiente } from '../../motor/mir/cli/preflight.ts'

function checagem(severidade: ChecagemDeAmbiente['severidade']): ChecagemDeAmbiente {
  return { nome: 'x', severidade, detalhe: '', conserto: '' }
}

function semNenhumBinario<T>(fn: () => T): T {
  const original = process.env.PATH
  process.env.PATH = join(tmpdir(), 'hicode-preflight-path-vazio-que-nao-existe')
  try {
    return fn()
  } finally {
    process.env.PATH = original
  }
}

interface ClaudeConfigDeTeste {
  oauthAccount?: { userRateLimitTier: string }
  cachedUsageUtilization?: {
    fetchedAtMs: number
    utilization: Record<string, { utilization: number; resets_at: string }>
  }
}

function comBinarioFalso<T>(nome: string, claudeJson: ClaudeConfigDeTeste | null, fn: () => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'hicode-preflight-bin-'))
  writeFileSync(join(dir, nome), '')
  const originalPath = process.env.PATH
  const originalConfig = process.env.HICODE_CLAUDE_CONFIG
  process.env.PATH = dir
  if (claudeJson) {
    const arquivo = join(dir, 'claude.json')
    writeFileSync(arquivo, JSON.stringify(claudeJson))
    process.env.HICODE_CLAUDE_CONFIG = arquivo
  }
  try {
    return fn()
  } finally {
    process.env.PATH = originalPath
    if (originalConfig === undefined) delete process.env.HICODE_CLAUDE_CONFIG
    else process.env.HICODE_CLAUDE_CONFIG = originalConfig
  }
}

test('bloqueia so quando ha erro entre as checagens', () => {
  expect(bloqueia([checagem('ok'), checagem('aviso')])).toBe(false)
  expect(bloqueia([checagem('ok'), checagem('erro')])).toBe(true)
  expect(bloqueia([])).toBe(false)
})

test('dependencias: node_modules ausente vira aviso com o comando exato de correcao', () => {
  const root = mkdtempSync(join(tmpdir(), 'hicode-preflight-'))
  const c = checarDependencias(root)
  expect(c.severidade).toBe('aviso')
  expect(c.detalhe).toContain(root)
  expect(c.conserto).toContain('bun install')
})

test('IA: CLI local instalado e autenticado dispensa o ollama', () => {
  const c = comBinarioFalso('claude', { oauthAccount: { userRateLimitTier: 'default_claude_pro' } }, () => checarIa(false))
  expect(c.severidade).toBe('ok')
  expect(c.detalhe).toContain('claude')
})

test('IA: CLI instalado mas sem login vira aviso, nunca erro — a TUI continua abrindo', () => {
  const c = comBinarioFalso('claude', {}, () => checarIa(false))
  expect(c.severidade).toBe('aviso')
  expect(c.detalhe).toContain('claude')
  expect(bloqueia([c])).toBe(false)
})

test('IA: CLI instalado com cota estourada vira aviso, nunca erro — a TUI continua abrindo', () => {
  const agora = Date.now()
  const c = comBinarioFalso('claude', {
    oauthAccount: { userRateLimitTier: 'default_claude_max_5x' },
    cachedUsageUtilization: {
      fetchedAtMs: agora - 60_000,
      utilization: { five_hour: { utilization: 100, resets_at: new Date(agora + 2 * 3600_000).toISOString() } },
    },
  }, () => checarIa(false))
  expect(c.severidade).toBe('aviso')
  expect(c.detalhe).toContain('claude')
  expect(bloqueia([c])).toBe(false)
})

test('IA: sem CLI local, mas ollama alcancavel pela rede conta como disponivel — servidor remoto nao e "ausente"', () => {
  const c = semNenhumBinario(() => checarIa(true))
  expect(c.severidade).toBe('ok')
  expect(c.detalhe).toContain('ollama')
})

test('IA: sem CLI local e sem ollama no ar vira erro com o conserto dos dois caminhos', () => {
  const c = semNenhumBinario(() => checarIa(false))
  expect(c.severidade).toBe('erro')
  expect(c.conserto).toContain('claude')
  expect(c.conserto).toContain('ollama')
})

test('preflight: nenhum binario no PATH bloqueia, e gh sozinho nunca bloqueia', () => {
  const checks = semNenhumBinario(() => preflight(false))
  expect(bloqueia(checks)).toBe(true)
  const gh = checks.find(c => c.nome === 'gh')
  expect(gh?.severidade).toBe('aviso')
})

test('preflight: ambiente com IA alcancavel so pela rede nao bloqueia por causa da IA', () => {
  const checks = semNenhumBinario(() => preflight(true))
  const ia = checks.find(c => c.nome === 'IA')
  expect(ia?.severidade).toBe('ok')
})

