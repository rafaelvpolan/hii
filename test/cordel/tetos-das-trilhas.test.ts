import { test, expect } from '../apoio/runner.ts'
import { readFileSync } from 'node:fs'

// As duas trilhas de teste precisam declarar o MESMO teto por teste, e este arquivo
// reprova se divergirem.
//
// Enquanto so a trilha node declarava (`--test-timeout=60000` em package.json), a
// trilha bun rodava no default do runner: 5.000 ms. A diferenca de 12x nao aparecia
// como defeito — aparecia como flake. Com a piscina cheia, `bun run test` reprovava
// 2 dos 248 arquivos (`test/cordel/import-com-extensao.test.ts` em 5.108 ms e
// `test/mirante/percurso-completo.test.ts` em 7.330 ms), e os mesmos dois passavam
// SOZINHOS em 1,2 s e 3,2 s — medido com load average 12,8 numa maquina de 8
// nucleos. Os dois sobem subprocesso; a piscina fabrica a carga que os derruba.
//
// Verde que depende de quem esta rodando junto nao e criterio de verde: era o
// gate local mentindo em relacao ao CI.
//
// Por que ler TEXTO e nao importar: `scripts/test-bun.mjs` tem top-level await que
// roda a suite inteira: importa-lo aqui reexecutaria os 248 arquivos de dentro de um
// deles.

const PACOTE = 'package.json'
const TRILHA_BUN = 'scripts/test-bun.mjs'

interface Pacote { readonly scripts: Record<string, string> }

function trilhaNode(): string {
  const { scripts } = JSON.parse(readFileSync(PACOTE, 'utf8')) as Pacote
  return scripts['test:node'] ?? ''
}

// A trilha node tem DUAS invocacoes (a piscina e os sensiveis a carga, sozinhos), e as
// duas precisam do mesmo teto — declarar so na primeira deixaria os isolados no default.
function tetosDaTrilhaNode(): number[] {
  const declarado = trilhaNode()
  const achados = [...declarado.matchAll(/--test-timeout=(\d+)/g)].map(m => Number(m[1]))
  expect(achados.length, `${PACOTE} scripts["test:node"] precisa declarar --test-timeout=<ms> em cada invocacao: ${declarado}`).toBe(2)
  return achados
}

function tetoDaTrilhaNode(): number {
  const [primeiro, segundo] = tetosDaTrilhaNode()
  expect(primeiro, 'as duas invocacoes da trilha node com tetos diferentes').toBe(segundo)
  return Number(primeiro)
}

function tetoDaTrilhaBun(): number {
  const fonte = readFileSync(TRILHA_BUN, 'utf8')
  // Guloso de proposito: a linha tem DOIS `||` (`env || 0` e `|| <default>`), e o
  // que interessa e o ultimo. Com `*?` a primeira versao capturava o `0` do fallback
  // de env e este arquivo reprovava a si mesmo — o que foi util: provou que a
  // checagem discrimina.
  const achado = /TETO_POR_TESTE_MS\s*=[^\n]*\|\|\s*([\d_]+)/.exec(fonte)
  expect(achado, `${TRILHA_BUN} precisa declarar TETO_POR_TESTE_MS com default numerico`).toBeTruthy()
  return Number(String(achado?.[1]).replace(/_/g, ''))
}

test('INVARIANTE as duas trilhas de teste declaram o mesmo teto por teste', () => {
  expect(tetoDaTrilhaBun()).toBe(tetoDaTrilhaNode())
})

// Declarar sem usar e o padrao de defeito que este repositorio mais repete
// ("mecanismo pronto sem consumidor"): a constante existir nao prova que o `bun
// test` a recebe.
test('INVARIANTE a trilha bun PASSA o teto ao bun test, nao apenas o declara', () => {
  const fonte = readFileSync(TRILHA_BUN, 'utf8')
  expect(fonte).toMatch(/spawn\('bun',\s*\[[^\]]*'--timeout',\s*String\(TETO_POR_TESTE_MS\)/)
})

// O teto tem de ser folgado o suficiente para os testes que SOBEM SUBPROCESSO. O
// numero nao e estetico: `node bin/hii.ts --help` custa ~0,15 s sem carga e passou
// de 5 s com a piscina cheia.
test('o teto por teste comporta subprocesso sob piscina cheia', () => {
  expect(tetoDaTrilhaBun()).toBeGreaterThanOrEqual(30_000)
})

// A SEGUNDA metade do mesmo problema, e a que sobrou depois de acertar o teto: teto
// generoso nao salva asserção que mede MILISSEGUNDO ABSOLUTO. `tempo-de-pintura` e
// `tui-sob-carga` medem tempo de parede, e a piscina fabrica a carga que os derruba —
// observado aqui: `quadro 50x200 levou 14,3ms, teto 8ms` com load average 11, e seis
// rodadas VERDES do mesmo codigo com load 5,6.
//
// `scripts/test-bun.mjs` ja resolvia isso desde 29/08, rodando os dois por ultimo e
// sozinhos. A trilha node nao: `node --test` paraleliza por padrao e os jogava junto
// com os outros 247 arquivos. Enquanto as duas trilhas nao isolarem o MESMO conjunto,
// `bun run test` continua sendo um verde que depende de load average.

function isoladosNaTrilhaBun(): string[] {
  const fonte = readFileSync(TRILHA_BUN, 'utf8')
  const bloco = /SENSIVEIS_A_CARGA\s*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(fonte)
  expect(bloco, `${TRILHA_BUN} precisa declarar SENSIVEIS_A_CARGA`).toBeTruthy()
  return [...String(bloco?.[1]).matchAll(/join\(([^)]*)\)/g)]
    .map(m => [...String(m[1]).matchAll(/'([^']+)'/g)].map(s => s[1]).join('/'))
    .sort()
}

function invocacoesDaTrilhaNode(): string[] {
  const partes = trilhaNode().split('&&')
  expect(partes.length, 'a trilha node precisa de DUAS invocacoes: a piscina, e os sensiveis a carga sozinhos').toBe(2)
  return partes
}

function isoladosNaTrilhaNode(): string[] {
  const [, isolados] = invocacoesDaTrilhaNode()
  return [...String(isolados).matchAll(/(test\/[\w\-/]+\.test\.ts)/g)].map(m => String(m[1])).sort()
}

test('INVARIANTE as duas trilhas isolam o MESMO conjunto de testes sensiveis a carga', () => {
  expect(isoladosNaTrilhaNode()).toEqual(isoladosNaTrilhaBun())
})

test('INVARIANTE a trilha node EXCLUI os sensiveis a carga da invocacao paralela', () => {
  const [piscina] = invocacoesDaTrilhaNode()
  for (const arquivo of isoladosNaTrilhaBun()) {
    const nome = arquivo.split('/').pop()?.replace('.test.ts', '') ?? ''
    // `[^&]*` e nao `[^|]*`: a propria exclusao usa `|` para alternar os dois nomes, e
    // a primeira versao desta regex nao alcancava o segundo. Reprovou, o que era o
    // comportamento certo — a regex mentia sobre o que checava.
    expect(String(piscina), `${nome} continua na invocacao paralela da trilha node`).toMatch(new RegExp(`grep -vE?[^&]*${nome}`))
    expect(String(piscina), `${arquivo} e passado direto para a invocacao paralela`).not.toContain(arquivo)
  }
})

test('INVARIANTE os sensiveis a carga rodam um por vez na trilha node', () => {
  const [, isolados] = invocacoesDaTrilhaNode()
  expect(String(isolados), 'sem isto os dois medem tempo de parede um contra o outro').toContain('--test-concurrency=1')
})
