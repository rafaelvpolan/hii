// Prova que todo import de scripts/setup/*.mjs RESOLVE, sem executar o script.
//
// Por que nao roda o script: eles apagam card, arquivam, mexem em contrato. Executar
// para descobrir se um import quebrou seria pagar o efeito colateral pelo diagnostico.
//
// Por que dois caminhos: a checagem original era `bun build --target=bun`, que caminha
// o GRAFO inteiro — e por isso e a preferida quando o bun esta na maquina. Mas este
// arquivo roda tambem na trilha `node --test`, e ali `bun` pode nao existir: a suite
// reprovava por ausencia de binario, nao por defeito. Sem bun, cai em
// `import.meta.resolve`, que resolve especificador sem carregar o modulo.
//
// O fallback e mais raso (um nivel, nao o grafo) e por isso NAO substitui o outro —
// o CI tem os dois runtimes e continua pagando a checagem profunda. O que ele impede
// e a suite ficar verde por pular a verificacao em silencio: sem bun ainda ha
// assercao, e ela reprova import quebrado no primeiro nivel.

import { test, expect } from './apoio/runner.ts'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SETUP_DIR = join(import.meta.dirname, '..', 'scripts', 'setup')

const TEM_BUN = spawnSync('sh', ['-c', 'command -v bun'], { stdio: 'ignore' }).status === 0

function scriptsDeSetup(): string[] {
  return readdirSync(SETUP_DIR).filter(f => f.endsWith('.mjs')).sort()
}

function especificadoresDe(caminho: string): string[] {
  const fonte = readFileSync(caminho, 'utf8')
  return [...fonte.matchAll(/^\s*(?:import|export)[^'"\n]*from\s*['"]([^'"]+)['"]/gm)].map(m => m[1] ?? '')
}

function resolve(spec: string, pai: URL): boolean {
  if (spec.startsWith('node:')) return true
  if (spec.startsWith('.') || spec.startsWith('/')) return existsSync(fileURLToPath(new URL(spec, pai)))
  try {
    createRequire(pai).resolve(spec)
    return true
  } catch {
    return false
  }
}

function naoResolvem(caminho: string): string[] {
  const pai = pathToFileURL(caminho)
  return especificadoresDe(caminho).filter(spec => !resolve(spec, pai))
}

function erroDoGrafo(caminho: string): string {
  const r = spawnSync('bun', ['build', caminho, '--target=bun'], { encoding: 'utf8' })
  return r.status === 0 ? '' : String(r.stderr ?? 'bun build reprovou sem stderr')
}

test('scripts/setup/ tem pelo menos os scripts que bin/hii.ts dispara por caminho', () => {
  const DISPARADOS_POR_HII_TS = ['archive.mjs', 'card.mjs', 'contract.mjs', 'doctor.mjs', 'repo.mjs', 'rm.mjs', 'teclas.mjs', 'wt-shift-enter.mjs']
  const achados = scriptsDeSetup()
  for (const nome of DISPARADOS_POR_HII_TS) expect(achados).toContain(nome)
})

test('o fallback sem bun so vale se extrair especificador de verdade — senao seria suite verde sem assercao', () => {
  const extraidos = especificadoresDe(join(SETUP_DIR, 'card.mjs'))
  expect(extraidos.length, 'sem especificador extraido o fallback nao provaria nada').toBeGreaterThan(0)
  expect(naoResolvem(join(SETUP_DIR, 'card.mjs'))).toEqual([])
})

for (const nome of scriptsDeSetup()) {
  test(`scripts/setup/${nome}: todo import resolve, sem executar o script`, () => {
    if (TEM_BUN) {
      expect(erroDoGrafo(join(SETUP_DIR, nome)), 'bun build caminha o grafo inteiro').toBe('')
      return
    }
    expect(naoResolvem(join(SETUP_DIR, nome)), 'sem bun, ao menos o primeiro nivel tem de resolver').toEqual([])
  })
}
