import { test, expect } from '../apoio/runner.ts'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname, resolve, relative } from 'node:path'

// O item 28 promete "a mesma imagem em qualquer lugar", e a Onda 11 tirou o bun
// do caminho obrigatorio. Faltava a parte que ninguem tinha exercitado: o Bun
// resolve `from './x'` sem extensao, e o resolvedor ESM do node NAO. A imagem
// construia com exit 0 e morria em ERR_MODULE_NOT_FOUND na primeira linha do
// ENTRYPOINT — `docker build` prova que a imagem CONSTROI, nunca que ela RODA.
//
// A suite inteira roda sob bun, entao ela era cega para isto por construcao.
// Os dois testes abaixo fecham o buraco por caminhos diferentes de proposito:
// o primeiro le o texto, o segundo EXECUTA. So o texto foi o que falhou antes.

const RAIZ_TESTE = ['bin', 'motor', 'test', 'runner.ts']

function arquivosTs(raiz: string): string[] {
  if (statSync(raiz).isFile()) return raiz.endsWith('.ts') ? [raiz] : []
  return readdirSync(raiz).flatMap(n => {
    if (n === 'node_modules' || n.startsWith('.')) return []
    return arquivosTs(join(raiz, n))
  })
}

// `from '...'` e `import('...')`, aspas simples ou duplas, so relativo.
const PADRAO = /(?:\bfrom\s*|\bimport\s*\(\s*)(['"])(\.\.?\/[^'"]*)\1/g
const EXT_JA = /\.(ts|tsx|js|mjs|cjs|json)$/

// Um especificador so conta como import de verdade se o alvo EXISTE. Sem essa
// guarda, o teste acusaria os literais de string que algumas fixtures escrevem
// dentro de arquivos temporarios — texto que parece import e nao e.
function resolveNoDisco(arquivo: string, spec: string): boolean {
  const alvo = resolve(dirname(arquivo), spec)
  for (const tentativa of [`${alvo}.ts`, join(alvo, 'index.ts')]) {
    try { if (statSync(tentativa).isFile()) return true } catch { /* segue */ }
  }
  return false
}

test('INVARIANTE todo import relativo carrega a extensao — sem ela o node nao resolve e a imagem nao sobe', () => {
  const culpados: string[] = []
  for (const arquivo of RAIZ_TESTE.flatMap(arquivosTs)) {
    const fonte = readFileSync(arquivo, 'utf8')
    for (const [, , spec] of fonte.matchAll(PADRAO)) {
      if (!spec || EXT_JA.test(spec)) continue
      if (resolveNoDisco(arquivo, spec)) culpados.push(`${relative(process.cwd(), arquivo)} -> ${spec}`)
    }
  }
  expect(culpados, 'o bun resolve import sem extensao e o node nao — escreva ./x.ts ou ./x/index.ts').toEqual([])
})

test('INVARIANTE o CLI carrega sob node puro — o grep de texto acima nao prova execucao', () => {
  const r = spawnSync('node', ['bin/hii.ts', '--help'], { encoding: 'utf8', timeout: 60_000 })
  expect(r.error, 'node precisa estar no PATH: e o runtime que a imagem de producao usa (node:24-slim)').toBeUndefined()
  const saida = `${r.stdout ?? ''}${r.stderr ?? ''}`
  expect(saida).not.toContain('ERR_MODULE_NOT_FOUND')
  expect(r.status, `node bin/hii.ts --help falhou:\n${saida.slice(0, 2000)}`).toBe(0)
})
