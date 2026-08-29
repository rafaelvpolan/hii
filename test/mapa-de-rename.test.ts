import { readFileSync } from 'node:fs'
import { test, expect } from './apoio/runner.ts'
// hicode:allow-any — o script de rename e .mjs sem tipos; a fronteira e checada aqui.
import {
  lerMapaDoDoc,
  expandir,
  conferirEstado,
  dominioDe,
  TOTAL_ESPERADO,
} from '../scripts/renomear-brazil.mjs'

const todos: [string, string][] = expandir(lerMapaDoDoc())

// O rename da Onda 1 esta CONCLUIDO, e `expandir` monta o mapa caminhando pelos
// diretorios em DISCO (para funcionar antes e depois da migracao). Consequencia: a
// contagem cresce a cada arquivo novo e legitimo em diretorio mapeado — e o teste
// reprovava trabalho correto.
//
// O que continua sendo invariante e a COBERTURA (nada que o doc declarou ficou de
// fora) e a injetividade, nao o numero absoluto. Arquivo novo pos-migracao nao
// pertence ao mapa historico.
test('o mapa cobre TUDO o que o doc declarou — arquivo novo pos-migracao pode somar', () => {
  expect(todos.length).toBeGreaterThanOrEqual(TOTAL_ESPERADO)
})

test('nenhum arquivo DECLARADO no doc ficou fora do mapa', () => {
  const { pares, prefixos } = lerMapaDoDoc() as { pares: [string, string][]; prefixos: [string, string][] }
  const destinos = new Set(todos.map(([, d]) => d))
  const faltando = pares.map(([, d]) => d).filter(d => !destinos.has(d))
  expect(faltando, 'par declarado no doc e ausente do mapa expandido').toEqual([])
  expect(prefixos.length, 'sem prefixo o mapa nao expandiria nada').toBeGreaterThan(0)
})

test('o mapa e injetivo — nenhum destino recebe dois arquivos', () => {
  const porDestino = new Map<string, string>()
  const colisoes: string[] = []
  for (const [origem, destino] of todos) {
    const anterior = porDestino.get(destino)
    if (anterior) colisoes.push(`${destino} <- ${anterior} e ${origem}`)
    porDestino.set(destino, origem)
  }
  expect(colisoes).toEqual([])
})

test('toda origem e destino tem caminho valido e distinto', () => {
  for (const [origem, destino] of todos) {
    expect(origem).not.toBe(destino)
    expect(origem.startsWith('lib/') || origem.startsWith('bin/lib/')).toBe(true)
    expect(destino.startsWith('motor/')).toBe(true)
  }
})

test('exatamente um lado de cada par existe em disco', () => {
  const estado = conferirEstado(todos)
  expect(estado.ambos.map(([o]: [string, string]) => o)).toEqual([])
  expect(estado.nenhum.map(([o]: [string, string]) => o)).toEqual([])
  expect(estado.origem.length + estado.destino.length, 'todo par tem exatamente um lado em disco').toBe(todos.length)
  expect(todos.length).toBeGreaterThanOrEqual(TOTAL_ESPERADO)
})

// Mesma correcao: a contagem por dominio era foto de disco no dia da migracao. O
// que segue valendo e que os DEZ dominios existem e que nenhum encolheu — encolher
// significaria arquivo do mapa perdido, que e o defeito de verdade.
test('os dez dominios da Onda 1 continuam todos la, e nenhum encolheu', () => {
  const minimo: Record<string, number> = {
    mirante: 57, tomada: 25, cordel: 20, euclides: 18, quilombo: 17,
    ciclo: 12, oswaldo: 9, niemeyer: 7, agentes: 6, cascudo: 1,
  }
  const real: Record<string, number> = {}
  for (const [, destino] of todos) {
    const d = dominioDe(destino)
    real[d] = (real[d] ?? 0) + 1
  }
  expect(Object.keys(real).sort(), 'dominio a mais ou a menos e deriva de verdade').toEqual(Object.keys(minimo).sort())
  for (const [dominio, n] of Object.entries(minimo)) {
    expect(real[dominio] ?? 0, `${dominio} encolheu: arquivo do mapa perdido`).toBeGreaterThanOrEqual(n)
  }
})

// O minimo por dominio e cego a TROCA: apagar motor/mirante/algo.ts e adicionar
// motor/mirante/novo.ts mantem a contagem e o teste passava. Perda de arquivo do mapa e
// o defeito de verdade, e so da para ver por NOME — por isso o destino de cada
// arquivo migrado esta congelado num fixture.
//
// Arquivo NOVO pos-migracao nao entra aqui (e por isso e subconjunto, nao
// igualdade): o fixture e a foto do que a migracao moveu, nao do repo de hoje.
test('nenhum arquivo migrado desapareceu — conferencia por NOME, nao por contagem', async () => {
  // `readFileSync` e nao `import(...json)`: o node exige `with { type: 'json' }` no
  // import de JSON e o bun nao, entao o import atravessaria so um dos runtimes.
  const congelado = JSON.parse(readFileSync('test/fixtures/mapa-rename-destinos.json', 'utf8')) as string[]
  const hoje = new Set(todos.map(([, d]) => d))
  const sumiram = congelado.filter(d => !hoje.has(d))
  expect(sumiram, 'destino que a migracao criou e que nao existe mais no mapa').toEqual([])
  expect(congelado.length, 'fixture vazio tornaria este teste incapaz de falhar').toBeGreaterThan(150)
})
