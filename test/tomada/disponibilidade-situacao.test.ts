import { test, expect, beforeEach, afterEach } from '../apoio/runner.ts'
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, delimiter } from 'node:path'

let binDir = ''
let claudeJson = ''
let pathAntigo = ''

function binarioFalso(nome: string): void {
  const caminho = join(binDir, nome)
  writeFileSync(caminho, '#!/bin/sh\nexit 0\n')
  chmodSync(caminho, 0o755)
}

beforeEach(() => {
  binDir = mkdtempSync(join(tmpdir(), 'hii-bin-'))
  binarioFalso('claude')
  pathAntigo = process.env.PATH ?? ''
  process.env.PATH = `${binDir}${delimiter}${pathAntigo}`
  claudeJson = join(binDir, 'claude.json')
  process.env.HICODE_CLAUDE_CONFIG = claudeJson
})

afterEach(() => {
  process.env.PATH = pathAntigo
  delete process.env.HICODE_CLAUDE_CONFIG
})

test('/ia lista os provedores com a situacao real de cada um', async () => {
  const { provedoresDisponiveis } = await import('../../motor/tomada/disponibilidade.ts')
  const { providerNames } = await import('../../motor/tomada/registro.ts')
  const lista = provedoresDisponiveis()
  expect(lista.map(p => p.nome).sort()).toEqual([...providerNames()].sort())
  const situacoesValidas = ['disponivel', 'ausente', 'precisa-servidor', 'nao-autenticado', 'cota-esgotada']
  expect(lista.every(p => situacoesValidas.includes(p.situacao))).toBe(true)
})

test('provedor de CLI ausente nao e apresentado como disponivel', async () => {
  const { provedoresDisponiveis } = await import('../../motor/tomada/disponibilidade.ts')
  const guardado = process.env.PATH
  process.env.PATH = '/caminho/que/nao/existe'
  const lista = provedoresDisponiveis()
  expect(lista.find(p => p.nome === 'claude')?.situacao).toBe('ausente')
  expect(lista.find(p => p.nome === 'claude')?.comoObter).toContain('CLI')
  process.env.PATH = guardado
})

test('provedor que depende de servidor nao mente que esta pronto', async () => {
  const { habilitadoDe } = await import('../../motor/cordel/alicerce/snapshot.ts')
  const { definirEstadoDoOllama } = await import('../../motor/tomada/harness/ollama-estado.ts')
  const instalado = { nome: 'ollama' as const, situacao: 'disponivel' as const, instalado: true, comoObter: '', modelo: '', papeis: [] }
  definirEstadoDoOllama({ habilitado: false, modelos: [], verificadoEm: Date.now() })
  expect(habilitadoDe('ollama', instalado)).toBe(false)
  definirEstadoDoOllama({ habilitado: true, modelos: ['qwen3:1.7b'], verificadoEm: Date.now() })
  expect(habilitadoDe('ollama', instalado)).toBe(true)
})

test('binario instalado mas sem oauthAccount aparece como nao-autenticado', async () => {
  writeFileSync(claudeJson, JSON.stringify({}))
  const { provedoresDisponiveis } = await import('../../motor/tomada/disponibilidade.ts')
  const claude = provedoresDisponiveis().find(p => p.nome === 'claude')
  expect(claude?.situacao).toBe('nao-autenticado')
  expect(claude?.comoObter).toContain('login')
})

test('autenticado mas com a janela de 5h em 100% e ainda sem resetar aparece como cota-esgotada', async () => {
  const agora = Date.parse('2026-08-19T18:00:00Z')
  writeFileSync(claudeJson, JSON.stringify({
    oauthAccount: { userRateLimitTier: 'default_claude_max_5x' },
    cachedUsageUtilization: {
      fetchedAtMs: agora - 60_000,
      utilization: { five_hour: { utilization: 100, resets_at: '2026-08-19T20:00:00Z' } },
    },
  }))
  const { provedoresDisponiveis } = await import('../../motor/tomada/disponibilidade.ts')
  const claude = provedoresDisponiveis(agora).find(p => p.nome === 'claude')
  expect(claude?.situacao).toBe('cota-esgotada')
  expect(claude?.comoObter).toContain('cota')
})

test('autenticado e com uso normal segue disponivel', async () => {
  const agora = Date.parse('2026-08-19T18:00:00Z')
  writeFileSync(claudeJson, JSON.stringify({
    oauthAccount: { userRateLimitTier: 'default_claude_max_5x' },
    cachedUsageUtilization: {
      fetchedAtMs: agora - 60_000,
      utilization: { five_hour: { utilization: 12, resets_at: '2026-08-19T20:00:00Z' } },
    },
  }))
  const { provedoresDisponiveis } = await import('../../motor/tomada/disponibilidade.ts')
  const claude = provedoresDisponiveis(agora).find(p => p.nome === 'claude')
  expect(claude?.situacao).toBe('disponivel')
})

test('/config nunca marca como habilitado uma ia sem login ou com cota estourada', async () => {
  const { habilitadoDe } = await import('../../motor/cordel/alicerce/snapshot.ts')
  const semLogin = { nome: 'claude' as const, situacao: 'nao-autenticado' as const, instalado: true, comoObter: '', modelo: '', papeis: [] }
  const cotaEstourada = { nome: 'claude' as const, situacao: 'cota-esgotada' as const, instalado: true, comoObter: '', modelo: '', papeis: [] }
  expect(habilitadoDe('claude', semLogin)).toBe(false)
  expect(habilitadoDe('claude', cotaEstourada)).toBe(false)
})

test('o rotulo da situacao no painel /config diferencia sem-login de cota estourada', async () => {
  const { painelDeIas } = await import('../../motor/mirante/render/config/paineis.ts')
  const base = { habilitado: false, motivo: '', plano: '', planoLido: true, rodaLocal: false, detalheDoPlano: '', idadeDoUsoHoras: -1, modelosDisponiveis: [], papeis: [], modelo: '', esforco: '', restringeFerramenta: true, isolaLeitura: true, reportaCusto: true, janelas: [] }
  const estado = {
    provedores: [
      { ...base, nome: 'claude', situacao: 'nao-autenticado' as const },
      { ...base, nome: 'codex', situacao: 'cota-esgotada' as const },
    ],
    selecionado: '', uso5h: [], usoSemana: [], serie: [], loop: [], fila: 0, gastoHoje: 0, tetoUsd: 0, projeto: '', sessao: { curto: '', papeis: [], custoUsd: 0, tokens: 0 },
  }
  const { stripAnsi } = await import('../../motor/mirante/tui/layout.ts')
  const linhas = painelDeIas(estado, 78, { color: false, largura: 78, altura: 10 }).map(stripAnsi)
  expect(linhas.join('\n')).toContain('sem login')
  expect(linhas.join('\n')).toContain('cota estourada')
})

test('binario ausente nunca conta como habilitado, mesmo com servidor no ar', async () => {
  const { habilitadoDe } = await import('../../motor/cordel/alicerce/snapshot.ts')
  const { definirEstadoDoOllama } = await import('../../motor/tomada/harness/ollama-estado.ts')
  definirEstadoDoOllama({ habilitado: true, modelos: ['x'], verificadoEm: Date.now() })
  const ausente = { nome: 'ollama' as const, situacao: 'ausente' as const, instalado: false, comoObter: '', modelo: '', papeis: [] }
  expect(habilitadoDe('ollama', ausente)).toBe(false)
  expect(habilitadoDe('ollama', undefined)).toBe(false)
})
