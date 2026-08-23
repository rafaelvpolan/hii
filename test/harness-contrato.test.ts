import { test, expect } from 'bun:test'
import { harnessPorNome, providerNames } from '../motor/tmd/registro'
import type { HarnessCapabilities } from '../motor/tmd/tipos'

const CHAVES: (keyof HarnessCapabilities)[] = [
  'restrictsTools', 'isolatesReadonly', 'acceptsEffort', 'reportsCostUsd', 'reportsTokens', 'mcp',
]

test('todo harness registrado declara o contrato inteiro — nada fica implicito', () => {
  for (const nome of providerNames()) {
    const h = harnessPorNome(nome)
    expect(typeof h.capabilities, `${nome}.capabilities`).toBe('function')
    expect(typeof h.healthCheck, `${nome}.healthCheck`).toBe('function')
    expect(typeof h.sinaisDeFalha, `${nome}.sinaisDeFalha`).toBe('function')
    expect(typeof h.run, `${nome}.run`).toBe('function')
  }
})

test('capabilities e obrigatoria e booleana em toda chave — "nao declarou" nao vale mais como "pode tudo"', () => {
  for (const nome of providerNames()) {
    const c = harnessPorNome(nome).capabilities()
    for (const chave of CHAVES) {
      expect(typeof c[chave], `${nome}.capabilities().${chave}`).toBe('boolean')
    }
  }
})

test('sinaisDeFalha traz as tres classes, sempre — a tabela central em cic/ deixou de existir', () => {
  for (const nome of providerNames()) {
    const s = harnessPorNome(nome).sinaisDeFalha()
    expect(Array.isArray(s.terminal), `${nome}.terminal`).toBe(true)
    expect(Array.isArray(s.quota), `${nome}.quota`).toBe(true)
    expect(Array.isArray(s.transient), `${nome}.transient`).toBe(true)
  }
})

test('REGRESSAO nenhum harness declara mcp sem declarar restricao de ferramenta', () => {
  const incoerentes = providerNames().filter(n => {
    const c = harnessPorNome(n).capabilities()
    return c.mcp && !c.restrictsTools
  })
  expect(incoerentes, 'MCP injeta ferramenta; sem restringir ferramenta o motor perde o controle do raio de acao').toEqual([])
})

test('REGRESSAO cic/ nao conhece nome de harness — senao harness novo obriga a mexer em cic/', async () => {
  const fonte = await Bun.file('motor/cic/rpr/classe-de-falha.ts').text()
  for (const nome of providerNames()) {
    expect(fonte.includes(`'${nome}'`), `classe-de-falha.ts cita '${nome}'`).toBe(false)
  }
})
