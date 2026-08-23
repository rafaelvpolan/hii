import { test, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { harnessPorNome, providerNames } from '../../motor/tmd/registro'
import type { HarnessCapabilities } from '../../motor/tmd/tipos'

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

const DESPACHO_POR_NOME = /(===|!==)\s*['"](claude|codex|kimi|ollama)['"]|\[\s*['"](claude|codex|kimi|ollama)['"]\s*\]/

function arquivosDoMotor(dir = 'motor'): string[] {
  const acc: string[] = []
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome)
    if (statSync(p).isDirectory()) acc.push(...arquivosDoMotor(p))
    else if (p.endsWith('.ts')) acc.push(p)
  }
  return acc
}

test('INVARIANTE nenhum despacho por nome de harness fora de motor/tmd/harness/', () => {
  const culpados: string[] = []
  for (const arquivo of arquivosDoMotor()) {
    if (arquivo.startsWith('motor/tmd/harness/')) continue
    const linhas = readFileSync(arquivo, 'utf8').split('\n')
    linhas.forEach((linha, i) => {
      if (linha.trimStart().startsWith('//')) return
      if (DESPACHO_POR_NOME.test(linha)) culpados.push(`${arquivo}:${i + 1}  ${linha.trim()}`)
    })
  }
  expect(culpados, 'harness novo teria de editar estes arquivos — o item 1 promete um arquivo novo + uma linha').toEqual([])
})

test('a varredura enxerga o codigo — senao o invariante passaria vazio', () => {
  const arquivos = arquivosDoMotor()
  expect(arquivos.length).toBeGreaterThan(150)
  expect(DESPACHO_POR_NOME.test("if (nome === 'ollama') return true")).toBe(true)
})

test('o descritor de cada harness diz a verdade sobre ele', () => {
  const ollama = harnessPorNome('ollama')
  expect(ollama.rodaLocal, 'ollama roda na maquina — e o que impede o painel de marcar (free) como tier pago').toBe(true)
  expect(ollama.comandoDeLogin).toEqual([])
  expect(ollama.exigeCliNoPath, 'ollama sobe como servidor; o doctor nao cobra --version').toBe(false)
  for (const nome of providerNames().filter(n => n !== 'ollama')) {
    expect(harnessPorNome(nome).rodaLocal, `${nome} nao roda local`).toBe(false)
    expect(harnessPorNome(nome).binario, `${nome} precisa de binario`).not.toBe('')
  }
})

test('registrar um harness e so somar uma linha: o registro nao guarda nada alem da lista', async () => {
  const fonte = await Bun.file('motor/tmd/registro.ts').text()
  const tabelas = fonte.match(/Record<HarnessId,/g) ?? []
  expect(tabelas, 'voltou tabela indexada por nome de harness no registro').toEqual([])
})
