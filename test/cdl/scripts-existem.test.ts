import { test, expect } from 'bun:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Um script que o motor invoca e uma dependencia igual a um import — mas o
// TypeScript nao verifica string. Quando um rename move o arquivo e esquece o
// call site, `run()` falha, o JSON nao parseia, e o catch devolve uma mensagem
// plausivel: "playwright ausente ou pagina inacessivel". Ninguem desconfia.
//
// Foi exatamente o que aconteceu com inspect-url.mjs. Esta varredura fecha a
// classe inteira, nao o caso.

function arquivosTs(raiz: string): string[] {
  return readdirSync(raiz).flatMap(n => {
    const c = join(raiz, n)
    return statSync(c).isDirectory() ? arquivosTs(c) : (n.endsWith('.ts') ? [c] : [])
  })
}

const REFERENCIA = /'scripts',\s*(?:'([^']+)'|`([^`$]+)`)(?:\s*,\s*'([^']+)')?/g

interface Referencia { readonly arquivo: string; readonly caminho: string }

function referenciasAScripts(): Referencia[] {
  const fora: Referencia[] = []
  for (const arquivo of [...arquivosTs('motor'), ...arquivosTs('bin')]) {
    const fonte = readFileSync(arquivo, 'utf8')
    for (const m of fonte.matchAll(REFERENCIA)) {
      const partes = [m[1] ?? m[2] ?? '', m[3] ?? ''].filter(Boolean)
      fora.push({ arquivo, caminho: join('scripts', ...partes) })
    }
  }
  return fora
}

test('a varredura enxerga as referencias — senao o invariante passaria vazio', () => {
  expect(referenciasAScripts().length).toBeGreaterThan(3)
})

test('INVARIANTE todo script que o motor invoca EXISTE no disco', () => {
  const fantasmas = referenciasAScripts()
    .filter(r => !r.caminho.includes('${') && !r.caminho.includes('`'))
    .filter(r => !existsSync(r.caminho))
    .map(r => `${r.arquivo} -> ${r.caminho}`)
  expect(fantasmas, 'script inexistente vira falha silenciosa: o catch devolve mensagem plausivel e ninguem desconfia').toEqual([])
})

test('o script de inspecao de url existe e sabe tirar screenshot — o gauntlet depende dele', () => {
  const fonte = readFileSync('motor/cic/crv/url-viva.ts', 'utf8')
  const m = fonte.match(/'scripts',\s*'([^']+)'/)
  const script = join('scripts', m?.[1] ?? 'inexistente')
  expect(existsSync(script), `url-viva.ts invoca ${script}`).toBe(true)
  const corpo = readFileSync(script, 'utf8')
  expect(corpo, 'sem screenshot nao ha tela do card, e sem tela o gauntlet nunca liga').toContain('screenshot')
  expect(corpo, 'o contrato de saida e o JSON que inspectUrl parseia').toContain('conclusive')
})
