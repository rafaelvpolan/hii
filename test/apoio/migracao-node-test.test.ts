import { test, expect } from './runner.ts'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Passo de fecho da migracao: sem isto ela vaza de volta um arquivo por vez, e o
// segundo runtime deixa de ser executavel sem ninguem perceber — que foi como a
// Onda 11 falhou antes.

// O UNICO arquivo que pode importar `bun:test`: o comparador diferencial, que
// precisa dos DOIS motores para provar que o shim nao e permissivo. Ele mesmo tem
// uma trava contra virar vacuo (`os dois expect sao motores DIFERENTES`).
const PODE_IMPORTAR_BUN_TEST = new Set(['test/apoio/expect-diferencial.test.ts'])

// `Bun.*` sobrevive so onde e DADO: fixtures sao scripts que rodam sob `bun` de
// proposito (o teste os spawna), e a ponte cita os nomes em comentario.
const PODE_CITAR_BUN = new Set(['test/apoio/bun.ts', 'test/apoio/migracao-node-test.test.ts'])

function arquivosTs(dir: string): string[] {
  const saida: string[] = []
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome)
    if (statSync(p).isDirectory()) { saida.push(...arquivosTs(p)); continue }
    if (p.endsWith('.ts')) saida.push(p)
  }
  return saida
}

const TODOS = arquivosTs('test')

// Este arquivo DESCREVE os padroes proibidos, entao ele os contem — em regex, em
// exemplo e em prosa. Varrer a si mesmo faria toda guarda aqui reprovar sempre. A
// contrapartida de excluir-se e o teste `conseguem acusar` no fim: sem ele, um regex
// que deixou de casar viraria guarda permanentemente verde, que e pior que ausente.
const ESTE_ARQUIVO = 'test/apoio/migracao-node-test.test.ts'
const ALVOS = TODOS.filter(f => f !== ESTE_ARQUIVO)

test('a varredura enxerga a suite — senao os invariantes abaixo passam vazios', () => {
  expect(TODOS.length, 'nenhum .ts encontrado em test/').toBeGreaterThan(200)
})

test('INVARIANTE nenhum teste importa bun:test — a suite tem de rodar nos dois runtimes', () => {
  const culpados = ALVOS
    .filter(f => !PODE_IMPORTAR_BUN_TEST.has(f))
    .filter(f => /from ['"]bun:test['"]/.test(readFileSync(f, 'utf8')))
  expect(culpados, 'importe de test/apoio/runner.ts').toEqual([])
})

test('INVARIANTE nenhuma API Bun.* fora das fixtures e da ponte', () => {
  const culpados = ALVOS
    .filter(f => !PODE_CITAR_BUN.has(f) && !f.startsWith('test/fixtures/'))
    .filter(f => {
      const fonte = readFileSync(f, 'utf8')
      // So conta ocorrencia FORA de string e de comentario: `Bun.spawn` aparece como
      // DADO em test/euc/idempotencia-contrato.test.ts, e a troca mecanica ja
      // corrompeu esse arquivo uma vez tratando texto como codigo.
      return fonte.split('\n').some(l => {
        const semComentario = l.replace(/\/\/.*$/, '')
        const m = semComentario.match(/\bBun\.[a-z]/)
        if (!m) return false
        const antes = semComentario.slice(0, m.index ?? 0)
        const emString = antes.split("'").length % 2 === 0 || antes.split('"').length % 2 === 0 || antes.split('`').length % 2 === 0
        return !emString
      })
    })
  expect(culpados, 'use as pontes de test/apoio/bun.ts').toEqual([])
})

// A forma curta de `import.meta` para a pasta do modulo (a que termina em "dir", sem
// "name") e extensao do BUN. O node so tem a longa — que o bun tambem tem. Onze
// arquivos usavam a curta e morriam no node ANTES de rodar um teste sequer: falha de
// CARREGAMENTO, que nao aparece como teste vermelho e sim como arquivo inteiro
// ausente da contagem, que e pior de notar.
// O padrao e MONTADO em vez de escrito literal: escrito, ele casaria com o proprio
// texto deste arquivo e o invariante reprovaria a si mesmo. Mesma armadilha do
// `Bun.spawn` que aparece como dado em outro teste.
const META_DO_BUN = new RegExp(['import', '\\.meta', '\\.dir', '\\b(?!name)'].join(''))

test('INVARIANTE nenhum teste usa a forma do bun para a pasta do modulo', () => {
  const culpados = ALVOS.filter(f => META_DO_BUN.test(readFileSync(f, 'utf8')))
  expect(culpados, 'use a forma longa, que existe nos dois runtimes').toEqual([])
})

test('e o proprio invariante consegue acusar — senao passaria vazio para sempre', () => {
  expect(META_DO_BUN.test('const R = dirname(import' + '.meta.dir)'), 'nao pega a forma do bun').toBe(true)
  expect(META_DO_BUN.test('const R = dirname(import' + '.meta.dirname)'), 'acusa a forma certa').toBe(false)
})

// A fachada e a ponte sao o unico caminho: se elas voltarem a depender de `bun:`, a
// suite inteira volta a ser de um runtime so sem nenhum teste reprovar.
test('INVARIANTE a fachada e a ponte nao dependem de nada do bun', () => {
  for (const f of ['test/apoio/runner.ts', 'test/apoio/bun.ts', 'test/apoio/expect.ts']) {
    const fonte = readFileSync(f, 'utf8')
    expect(/from ['"]bun:/.test(fonte), `${f} importa de bun:`).toBe(false)
  }
})

test('as fixtures que usam Bun.* sao SPAWNADAS sob bun, nao importadas pela suite', () => {
  const comBun = arquivosTs('test/fixtures').filter(f => /\bBun\.[a-z]/.test(readFileSync(f, 'utf8')))
  expect(comBun.length, 'a lista nao pode estar vazia — o invariante ficaria sem sujeito').toBeGreaterThan(0)
  const fonteDaSuite = ALVOS.filter(f => !f.startsWith('test/fixtures/')).map(f => readFileSync(f, 'utf8')).join('\n')
  for (const f of comBun) {
    const nome = f.split('/').pop() ?? ''
    expect(fonteDaSuite.includes(`from './fixtures/${nome}'`) || fonteDaSuite.includes(`from '../fixtures/${nome}'`),
      `${nome} e importado pela suite — sob node o Bun.* dela quebraria`).toBe(false)
  }
})

// As armadilhas abaixo NAO aparecem como teste vermelho: elas derrubam o arquivo no
// carregamento, e o arquivo some da contagem. Cada uma foi encontrada rodando a
// suite no node pela primeira vez, e cada uma volta em silencio sem uma guarda.

test('INVARIANTE nenhum teste usa require() — o node em ESM nao tem', () => {
  const culpados = ALVOS.filter(f => /(?:^|[^.\w])require\s*\(/.test(readFileSync(f, 'utf8')))
  expect(culpados, 'use import estatico ou await import()').toEqual([])
})

test('INVARIANTE import dinamico leva .ts ANTES da query — senao o node nao resolve', () => {
  const culpados: string[] = []
  for (const f of ALVOS) {
    for (const m of readFileSync(f, 'utf8').matchAll(/import\(\s*[`'"]([^`'"]+)[`'"]\s*\)/g)) {
      const alvo = m[1] ?? ''
      // `...` e reticencia de exemplo, nao caminho: test/cdl/import-com-extensao
      // guarda esta mesma regra e cita formas ilustrativas.
      if (!alvo.startsWith('.') || alvo.includes('...')) continue
      const semQuery = alvo.split('?')[0] ?? ''
      if (!semQuery.endsWith('.ts') && !semQuery.endsWith('.json')) culpados.push(`${f}: ${alvo}`)
    }
  }
  expect(culpados, 'o bun resolve import sem extensao e o node nao').toEqual([])
})

test('INVARIANTE nenhum teste importa JSON por import() — o node exige atributo de tipo', () => {
  const culpados = ALVOS.filter(f => /import\(\s*[`'"][^`'"]+\.json[`'"]\s*\)/.test(readFileSync(f, 'utf8')))
  expect(culpados, "o node pede with { type: 'json' }; leia com readFileSync + JSON.parse").toEqual([])
})

test('os quatro invariantes de portabilidade conseguem acusar', () => {
  // Sem isto, um regex que deixou de casar viraria uma guarda permanentemente verde.
  const META_OK = new RegExp(['import', '\\.meta', '\\.dir', '\\b(?!name)'].join(''))
  expect(META_OK.test('dirname(import' + '.meta.dir)')).toBe(true)
  expect(/(?:^|[^.\w])require\s*\(/.test("const x = require('node:fs')")).toBe(true)
  expect(/(?:^|[^.\w])require\s*\(/.test('obj.require(1)'), 'metodo chamado require nao conta').toBe(false)
  expect(/import\(\s*[`'"][^`'"]+\.json[`'"]\s*\)/.test("await import('./a.json')")).toBe(true)
})
