import { test, expect } from '../apoio/runner.ts'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Um script que o motor invoca e uma dependencia igual a um import — mas o
// TypeScript nao verifica string. Quando um rename move o arquivo e esquece o
// call site, `run()` falha, o JSON nao parseia, e o catch devolve uma mensagem
// plausivel: "playwright ausente ou pagina inacessivel". Ninguem desconfia.
//
// Foi exatamente o que aconteceu com inspect-url.mjs.
//
// A primeira versao desta varredura NAO fechava a classe, apesar de dizer que
// fechava: a regex parava no ultimo segmento entre aspas, entao o despacho
// dinamico de bin/hii.ts (join(..., 'scripts', 'setup', `${name}.mjs`)) derivava o
// caminho "scripts/setup" — um DIRETORIO — e existsSync devolvia true. Os oito
// scripts/setup/*.mjs ficavam de fora do invariante que passava verde.
//
// Duas correcoes: exigir ARQUIVO (nao apenas existencia), e resolver o despacho
// dinamico pelos nomes literais que o codigo de fato passa.

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

function ehArquivo(caminho: string): boolean {
  try {
    return statSync(caminho).isFile()
  } catch {
    return false
  }
}

function ehDiretorio(caminho: string): boolean {
  try {
    return statSync(caminho).isDirectory()
  } catch {
    return false
  }
}

// Uma referencia que resolve para DIRETORIO nao e um script: e o prefixo de um
// caminho montado dinamicamente. Ela nao pode ser pulada em silencio (era assim
// que os oito scripts/setup/*.mjs escapavam), entao vira um caso proprio, com
// invariante proprio logo abaixo.
const REFERENCIAS = referenciasAScripts().filter(r => !r.caminho.includes('${') && !r.caminho.includes('`'))
const PREFIXOS_DINAMICOS = REFERENCIAS.filter(r => ehDiretorio(r.caminho))
const ARQUIVOS_ESTATICOS = REFERENCIAS.filter(r => !ehDiretorio(r.caminho))

test('INVARIANTE todo script invocado por caminho estatico EXISTE e e ARQUIVO', () => {
  const fantasmas = ARQUIVOS_ESTATICOS
    .filter(r => !ehArquivo(r.caminho))
    .map(r => `${r.arquivo} -> ${r.caminho}`)
  expect(fantasmas, 'script inexistente vira falha silenciosa: o catch devolve mensagem plausivel e ninguem desconfia').toEqual([])
})

test('INVARIANTE todo prefixo dinamico de scripts/ tem invariante proprio cobrindo as folhas', () => {
  // Hoje ha exatamente um: scripts/setup, coberto pelo teste de nomes despachados.
  // Um prefixo novo aqui significa uma familia de scripts sem cobertura — o teste
  // reprova para forcar a decisao, em vez de deixar passar como existsSync fazia.
  const cobertos = new Set(['scripts/setup'])
  const descobertos = PREFIXOS_DINAMICOS
    .map(r => r.caminho)
    .filter(c => !cobertos.has(c))
  expect(descobertos, 'prefixo dinamico sem invariante que resolva as folhas — acrescente a cobertura antes de liberar').toEqual([])
})

// O despacho dinamico: bin/hii.ts monta o caminho com template literal, entao a
// varredura por texto acima nao alcanca. Os nomes, porem, sao literais no call
// site — da para resolver cada um e exigir o arquivo.
const DESPACHO_DINAMICO = /\bscript\('([a-z0-9-]+)'/g

function nomesDespachados(): string[] {
  const fonte = readFileSync(join('bin', 'hii.ts'), 'utf8')
  return [...new Set([...fonte.matchAll(DESPACHO_DINAMICO)].map(m => m[1] ?? '').filter(Boolean))]
}

test('a varredura enxerga o despacho dinamico — senao o invariante abaixo passaria vazio', () => {
  expect(nomesDespachados().length, 'bin/hii.ts despacha scripts/setup por nome; se isto zerar, a regex quebrou').toBeGreaterThan(3)
})

test('INVARIANTE todo nome despachado para scripts/setup resolve num arquivo real', () => {
  const fantasmas = nomesDespachados()
    .map(nome => join('scripts', 'setup', `${nome}.mjs`))
    .filter(caminho => !ehArquivo(caminho))
  expect(fantasmas, 'bin/hii.ts chama script(<nome>) e o arquivo nao existe — o comando falha em runtime sem aviso de compilacao').toEqual([])
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
