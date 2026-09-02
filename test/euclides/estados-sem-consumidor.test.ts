import { test, expect } from '../apoio/runner.ts'
import { readFileSync } from 'node:fs'
import { STATUSES } from '../../motor/cordel/index.ts'
import { SEM_CONSUMIDOR_AUTOMATICO } from '../../motor/euclides/radar/saude.ts'

// `esperandoVoce` responde "quem esta esperando voce, e desde quando". A resposta vale
// o tanto que a lista de estados estiver certa, e a lista e escrita a mao — entao este
// arquivo DERIVA o conjunto das fontes reais e reprova se divergir.
//
// Existe porque a lista foi contestada uma vez, com a acusacao de que omitia sete
// estados alcancaveis (`INBOX`, `PLAN_APPROVED`, `REFINED`, `TESTS_GREEN`,
// `SEC_CLEARED`, `REVIEWED`, `CLEANED`). A acusacao estava errada: cinco deles sao
// recuperados por `reconcileStranded` no arranque e dois estao declarados em
// `semEscritaNoMotor`. Mas nada no repositorio provava isso — a conferencia foi manual,
// e manual nao sobrevive ao proximo estado novo. Agora prova.
//
// Le TEXTO-FONTE de proposito. Importar `pending()` ou `reconcileStranded()` para
// perguntar o que consomem exigiria montar cards de todos os 22 estados e observar o
// efeito; a declaracao esta em constante e chamada literal, e e ali que a deriva
// aparece primeiro.

const FILA = 'motor/oswaldo/mutirao/estado-da-fila.ts'
const ESPERA = 'motor/ciclo/reprise/espera.ts'
const MERGE = 'motor/quilombo/cartorio/merge.ts'
const TOPOLOGIA = 'config/topologia.json'

interface Topologia {
  readonly transicoes: readonly (readonly string[])[]
  readonly transicoesDeRecuperacao?: readonly (readonly string[])[]
  readonly semEscritaNoMotor: { readonly estados: readonly string[] }
}

function fonte(caminho: string): string {
  return readFileSync(caminho, 'utf8')
}

function topologia(): Topologia {
  return JSON.parse(fonte(TOPOLOGIA)) as Topologia
}

function estadosEm(texto: string, padrao: RegExp): string[] {
  return [...texto.matchAll(padrao)].map(m => String(m[1]))
}

function constanteDeEstados(texto: string, nome: string): string[] {
  const bloco = new RegExp(`const ${nome} = \\[([^\\]]*)\\]`).exec(texto)
  expect(bloco, `${FILA} precisa declarar ${nome}`).toBeTruthy()
  return estadosEm(String(bloco?.[1]), /'([A-Z_]+)'/g)
}

// Consumido DENTRO do tick: o motor tira o card daqui sozinho, sem reinicio.
function consumidosNoTick(): Set<string> {
  return new Set([
    ...estadosEm(fonte(FILA), /porStatus\('([A-Z_]+)'\)/g),
    ...estadosEm(fonte(ESPERA), /cardsByStatus\('([A-Z_]+)'\)/g),
    ...estadosEm(fonte(MERGE), /cardsByStatus\('([A-Z_]+)'\)/g),
  ])
}

// Recuperado no ARRANQUE por `reconcileStranded`. Nao e o mesmo que consumido no tick —
// um card que cai aqui com o daemon no ar espera o proximo reinicio — mas tambem nao e
// "esperando voce": ninguem precisa decidir nada.
function recuperadosNoBoot(): Set<string> {
  const texto = fonte(FILA)
  return new Set([
    ...constanteDeEstados(texto, 'FINISH_STATES'),
    ...constanteDeEstados(texto, 'RERUN_STATES'),
    ...estadosEm(texto, /cardsByStatus\('([A-Z_]+)'\)/g),
  ])
}

// Terminal DE FATO: toda saida declarada leva a estado que o motor nunca escreve. Pega
// `MERGED`, cuja unica saida e `DEPLOYED` — que esta em `semEscritaNoMotor`. Comparar
// so "nao e origem de transicao" deixaria `MERGED` de fora e a particao nao fecharia.
function terminaisDeFato(): Set<string> {
  const topo = topologia()
  const nunca = new Set(topo.semEscritaNoMotor.estados)
  const transicoes = [...topo.transicoes, ...(topo.transicoesDeRecuperacao ?? [])]
  return new Set(STATUSES.filter(s => transicoes.filter(t => t[0] === s).every(t => nunca.has(String(t[1])))))
}

test('a varredura enxerga as fontes — senao a particao fecharia vazia', () => {
  expect(consumidosNoTick().size, 'nenhum porStatus/cardsByStatus encontrado').toBeGreaterThan(3)
  expect(recuperadosNoBoot().size).toBeGreaterThan(3)
  expect(topologia().semEscritaNoMotor.estados.length).toBeGreaterThan(0)
})

test('INVARIANTE a lista de estados sem consumidor e exatamente o que sobra de STATUSES', () => {
  const consumidos = consumidosNoTick()
  const boot = recuperadosNoBoot()
  const nunca = new Set(topologia().semEscritaNoMotor.estados)
  const terminais = terminaisDeFato()
  const sobra = STATUSES.filter(s =>
    !consumidos.has(s) && !boot.has(s) && !nunca.has(s) && !terminais.has(s) && s !== 'HALTED')
  expect(
    [...sobra].sort(),
    'estado novo em STATUSES precisa ser classificado: ou alguem o consome, ou entra em SEM_CONSUMIDOR_AUTOMATICO e passa a aparecer em esperandoVoce',
  ).toEqual([...SEM_CONSUMIDOR_AUTOMATICO].sort())
})

test('HALTED fica FORA da lista: tem leitura propria em paradas[]', () => {
  expect(SEM_CONSUMIDOR_AUTOMATICO).not.toContain('HALTED')
})

test('PR_OPEN e WAITING ficam fora: os dois tem consumidor automatico', () => {
  const consumidos = consumidosNoTick()
  expect(consumidos.has('PR_OPEN'), 'quilombo/cartorio/merge.ts tira PR_OPEN a cada 30s').toBe(true)
  expect(consumidos.has('WAITING'), 'ciclo/reprise/espera.ts acorda WAITING').toBe(true)
  expect(SEM_CONSUMIDOR_AUTOMATICO).not.toContain('PR_OPEN')
  expect(SEM_CONSUMIDOR_AUTOMATICO).not.toContain('WAITING')
})

// A refutacao concreta do achado que gerou este arquivo, congelada para nao voltar.
test('os estados do pipeline de polimento NAO estao orfaos: reconcileStranded os resgata', () => {
  const boot = recuperadosNoBoot()
  for (const estado of ['REFINED', 'TESTS_GREEN', 'SEC_CLEARED', 'REVIEWED', 'CLEANED', 'EXECUTED']) {
    expect(boot.has(estado), `${estado} deixou de ser recuperado no arranque — agora ele PRECISA entrar em SEM_CONSUMIDOR_AUTOMATICO`).toBe(true)
  }
})

test('INBOX e PLAN_APPROVED nao estao orfaos: a topologia declara que o motor nunca os escreve', () => {
  const nunca = new Set(topologia().semEscritaNoMotor.estados)
  expect(nunca.has('INBOX')).toBe(true)
  expect(nunca.has('PLAN_APPROVED')).toBe(true)
})
