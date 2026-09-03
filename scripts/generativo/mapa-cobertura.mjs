#!/usr/bin/env node
// Mapa deterministico de cobertura: nenhum token de IA gasto aqui.
// Um arquivo de motor/ conta como "exercitado" se algum test/**/*.ts o importa
// (diretamente, pelo caminho). Indiretos ficam de fora — e heuristica de triagem,
// nao prova de cobertura; o julgamento fino fica para o humano ou para a IA.
// Uso: node scripts/generativo/mapa-cobertura.mjs [--json out.json]
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'

function* walk(dir) {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (nome.endsWith('.ts')) yield p
  }
}

const motor = [...walk('motor')].map(p => relative('.', p))
const referenciados = new Set()
// Import estatico E dinamico: 137 dos 248 arquivos da suite usam `await import()`
// no topo (para configurar env antes do modulo carregar); olhar so `from` subconta
// a cobertura massivamente — foi o falso positivo que pos politica.ts na lista.
const IMPORT_RE = /(?:from\s+|import\(\s*)['"]([^'"]*motor\/[^'"]+)['"]/g

function normaliza(spec, testFile) {
  // resolve o specifier relativo ao teste para caminho de repo
  const base = join(testFile, '..')
  let p = join(base, spec)
  if (!p.endsWith('.ts')) p += '.ts'
  return relative('.', p).replaceAll('\\', '/')
}

for (const t of walk('test')) {
  const fonte = readFileSync(t, 'utf8')
  for (const m of fonte.matchAll(IMPORT_RE)) referenciados.add(normaliza(m[1], t))
}

// Barrels: teste que importa motor/<dominio>/index.ts exercita os arquivos que
// o index re-exporta (frontmatter.ts so apareceu "sem teste" por causa disto).
// BFS pelos re-exports, um nivel nao basta: index -> sub/index -> arquivo.
const REEXPORT_RE = /export\s+(?:\*|\{[^}]*\})\s+from\s+['"](\.[^'"]+)['"]/g
const reexporta = new Map()
for (const f of motor) {
  const fonte = readFileSync(f, 'utf8')
  const alvos = []
  for (const m of fonte.matchAll(REEXPORT_RE)) {
    let p = join(f, '..', m[1])
    if (!p.endsWith('.ts')) p += '.ts'
    alvos.push(relative('.', p).replaceAll('\\', '/'))
  }
  if (alvos.length) reexporta.set(f, alvos)
}
const fila = [...referenciados]
while (fila.length) {
  const f = fila.pop()
  for (const alvo of reexporta.get(f) ?? []) {
    if (!referenciados.has(alvo)) { referenciados.add(alvo); fila.push(alvo) }
  }
}

const porDominio = {}
const semTeste = []
for (const f of motor) {
  const dominio = f.split('/')[1]
  const d = (porDominio[dominio] ??= { total: 0, exercitados: 0 })
  d.total++
  if (referenciados.has(f)) d.exercitados++
  else semTeste.push(f)
}

const rel = {
  gerado_em: new Date().toISOString(),
  heuristica: 'import direto (estatico/dinamico) em test/**/*.ts, expandido por re-exports (barrels); indiretos nao contam',
  total_motor: motor.length,
  exercitados: motor.length - semTeste.length,
  por_dominio: porDominio,
  sem_teste_direto: semTeste,
}

const i = process.argv.indexOf('--json')
if (i >= 0) {
  mkdirSync(dirname(process.argv[i + 1]), { recursive: true })
  writeFileSync(process.argv[i + 1], JSON.stringify(rel, null, 2))
}
console.log(`motor/: ${rel.total_motor} arquivos, ${rel.exercitados} com import direto em teste, ${semTeste.length} sem`)
for (const [d, v] of Object.entries(porDominio).sort())
  console.log(`  ${d.padEnd(12)} ${String(v.exercitados).padStart(3)}/${v.total}`)
console.log('\nsem teste direto:')
for (const f of semTeste) console.log(`  ${f}`)
