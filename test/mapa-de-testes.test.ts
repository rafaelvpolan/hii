import { test, expect } from './apoio/runner.ts'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
// hicode:allow-any — o script de rename e .mjs; a fronteira e checada aqui.
import { caminhosNaoAlcancaveis } from '../scripts/renomear-testes-brazil.mjs'

const DOMINIOS = ['agentes', 'cordel', 'ciclo', 'cascudo', 'euclides', 'mirante', 'niemeyer', 'oswaldo', 'quilombo', 'tomada']
// Só o que não exercita motor/ fica na raiz: guardas do próprio repositório.
const NA_RAIZ = [
  'isolamento-de-testes.test.ts',
  'mapa-de-rename.test.ts',
  'mapa-de-testes.test.ts',
  'no-any-detect.test.ts',
  'scripts-setup-imports.test.ts',
]

function testesEm(dir: string): string[] {
  return readdirSync(dir).filter(n => n.endsWith('.test.ts'))
}

test('a raiz de test/ so guarda os testes que nao exercitam motor/', () => {
  expect(testesEm('test').sort()).toEqual([...NA_RAIZ].sort())
})

// Pastas de APOIO: nao guardam teste de dominio, guardam a infraestrutura da suite.
// Lista nominal e nao um padrao ("tudo que nao e dominio passa"), para acrescentar
// uma ser edicao deliberada e visivel na revisao — que e o ponto deste invariante.
const APOIO = ['fixtures', 'apoio']

test('toda subpasta de test/ espelha um dominio de motor/', () => {
  const pastas = readdirSync('test').filter(n => statSync(join('test', n)).isDirectory() && !APOIO.includes(n))
  expect(pastas.sort()).toEqual([...DOMINIOS].sort())
})

test('pasta de apoio NAO guarda teste de dominio disfarcado', () => {
  for (const pasta of APOIO) {
    const dir = join('test', pasta)
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.test.ts')) continue
      const fonte = readFileSync(join(dir, f), 'utf8')
      expect(fonte.includes("from '../../motor/"), `${pasta}/${f} testa motor/ e devia estar no dominio dele`).toBe(false)
    }
  }
})

test('INVARIANTE nenhum teste calcula a raiz do repo com um unico ".."', () => {
  const profundidade = caminhosNaoAlcancaveis().filter((m: { motivo: string }) => m.motivo.includes("unico"))
  expect(profundidade, 'teste em subpasta com raiz de um nivel aponta para test/, nao para o repo').toEqual([])
})

const TEST_NODE = (JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }).scripts['test:node'] ?? ''

function arquivosEnumeradosPelaTrilhaNode(cwd: string): string[] {
  const somenteListar = TEST_NODE.replace(/node --test(?: --[a-z-]+=\S+)*/g, "printf '%s\\n'")
  const saida = execSync(somenteListar, { cwd, encoding: 'utf8', shell: '/bin/sh' })
  return saida.split('\n').map(l => l.trim()).filter(l => l.endsWith('.test.ts')).sort()
}

function testesRecursivos(dir: string): string[] {
  const achados: string[] = []
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) achados.push(...testesRecursivos(caminho))
    else if (nome.endsWith('.test.ts')) achados.push(caminho)
  }
  return achados.sort()
}

test('a trilha node enumera teste em QUALQUER profundidade — o glob de 2 niveis engolia o 3o nivel em SILENCIO', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'hicode-trilha-node-'))
  try {
    const fundos = ['test/dom/sub/fundo.test.ts', 'test/dom/sub/mais/fundo2.test.ts']
    const arvore = ['test/raiz.test.ts', 'test/dom/raso.test.ts', ...fundos, 'test/apoio/expect-diferencial.test.ts', 'test/mirante/tempo-de-pintura.test.ts', 'test/mirante/tui-sob-carga.test.ts']
    for (const rel of arvore) {
      mkdirSync(join(raiz, dirname(rel)), { recursive: true })
      writeFileSync(join(raiz, rel), '')
    }
    const enumerados = arquivosEnumeradosPelaTrilhaNode(raiz)
    for (const f of fundos) expect(enumerados, `${f} ficou FORA da trilha node: package.json test:node nao desce alem de 2 niveis`).toContain(f)
    expect(enumerados, 'o expect-diferencial e a excecao deliberada e continua fora').not.toContain('test/apoio/expect-diferencial.test.ts')
    expect(enumerados.filter(f => f.includes('mirante/')).length, 'os dois sensiveis a carga entram uma vez, na invocacao serial').toBe(2)
  } finally {
    rmSync(raiz, { recursive: true, force: true })
  }
})

test('todo .test.ts sob test/, em qualquer profundidade, entra na trilha node — menos o expect-diferencial', () => {
  const esperados = testesRecursivos('test').filter(f => !f.includes('apoio/expect-diferencial'))
  expect(esperados.length, 'varredura vazia tornaria a guarda incapaz de falhar').toBeGreaterThan(140)
  expect(arquivosEnumeradosPelaTrilhaNode('.')).toEqual(esperados)
})

test('a varredura enxerga os arquivos — senao o invariante passaria vazio', () => {
  const total = DOMINIOS.reduce((n, d) => n + testesEm(join('test', d)).length, 0)
  expect(total).toBeGreaterThan(140)
})
