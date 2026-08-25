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

test('a varredura enxerga a suite — senao os invariantes abaixo passam vazios', () => {
  expect(TODOS.length, 'nenhum .ts encontrado em test/').toBeGreaterThan(200)
})

test('INVARIANTE nenhum teste importa bun:test — a suite tem de rodar nos dois runtimes', () => {
  const culpados = TODOS
    .filter(f => !PODE_IMPORTAR_BUN_TEST.has(f))
    .filter(f => /from ['"]bun:test['"]/.test(readFileSync(f, 'utf8')))
  expect(culpados, 'importe de test/apoio/runner.ts').toEqual([])
})

test('INVARIANTE nenhuma API Bun.* fora das fixtures e da ponte', () => {
  const culpados = TODOS
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
  const fonteDaSuite = TODOS.filter(f => !f.startsWith('test/fixtures/')).map(f => readFileSync(f, 'utf8')).join('\n')
  for (const f of comBun) {
    const nome = f.split('/').pop() ?? ''
    expect(fonteDaSuite.includes(`from './fixtures/${nome}'`) || fonteDaSuite.includes(`from '../fixtures/${nome}'`),
      `${nome} e importado pela suite — sob node o Bun.* dela quebraria`).toBe(false)
  }
})
