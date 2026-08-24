import { test, expect } from 'bun:test'
import { complete } from '../../motor/mir/completar.ts'
import { ALIASES, COMMANDS } from '../../motor/mir/sessao.ts'
import { AJUDA_DO_COMANDO } from '../../motor/mir/render/sugestoes.ts'

const ctx = { repos: ['acme/site', 'acme/api'], cards: ['019', '020'] }

test('completar: barra sozinha lista os comandos', () => {
  expect(complete('/', ctx)[0]).toContain('/repo')
  expect(complete('/re', ctx)[0]).toEqual(['/ref', '/repo'])
  expect(complete('/rep', ctx)[0]).toEqual(['/repo'])
})

test('completar /repo sugere os repos registrados', () => {
  expect(complete('/repo ', ctx)[0]).toEqual(['acme/site', 'acme/api'])
  expect(complete('/repo acme/a', ctx)[0]).toEqual(['acme/api'])
})

test('completar /halt (apelido de /stop) sugere ids de card', () => {
  expect(complete('/halt ', ctx)[0]).toEqual(['019', '020'])
  expect(complete('/halt 02', ctx)[0]).toEqual(['020'])
})

test('comando cortado nao completa nada', () => {
  for (const morto of ['/cards ', '/plan ', '/watch ', '/url ', '/ok ']) {
    expect(complete(morto, ctx)[0], morto).toEqual([])
  }
})

test('texto livre nao completa', () => {
  expect(complete('adicionar um selo', ctx)[0]).toEqual([])
})

test('nao completa alem do primeiro argumento', () => {
  expect(complete('/halt 020 motivo qual', ctx)[0]).toEqual([])
})

test('completar sugere ids em /stop e /rm', () => {
  for (const c of ['/stop ', '/rm ']) expect(complete(c, ctx)[0]).toEqual(['019', '020'])
})

test('REGRESSAO apelido completa os mesmos argumentos que o principal', () => {
  for (const [principal, apelidos] of Object.entries(ALIASES)) {
    const esperado = complete(`${principal} `, ctx)[0]
    for (const apelido of apelidos) {
      expect(complete(`${apelido} `, ctx)[0], `${apelido} vs ${principal}`).toEqual(esperado)
    }
  }
})

test('/new-task, /new-ask e /new-session estao no catalogo e no autocompletar', () => {
  const lista: string[] = [...COMMANDS]
  for (const c of ['/new-task', '/new-ask', '/new-session']) {
    expect(lista, c).toContain(c)
    expect(AJUDA_DO_COMANDO[c], c).toBeTruthy()
  }
})

test('/new e forma curta de /new-session: match exato aprova, TAB ainda mostra os tres longos', () => {
  expect(ALIASES['/new-session']).toContain('/new')
  expect(complete('/new', ctx)[0]).toEqual(['/new-task', '/new-ask', '/new-session'])
})

test('comandos da ia ativa entram como complemento, depois dos do hii', () => {
  const comIa = { ...ctx, comandosDaIa: ['/review', '/refactor'] }
  expect(complete('/re', comIa)[0]).toEqual(['/ref', '/repo', '/review'])
})

test('os comandos do hii sao MAIORIA, nao empate — a ia fica sempre em minoria estrita', () => {
  const comIa = { ...ctx, comandosDaIa: ['/rex1', '/rex2', '/rex3', '/rex4', '/rex5'] }
  const r = complete('/re', comIa)[0]
  const doHii = r.filter(c => ['/ref', '/repo'].includes(c))
  const daIa = r.filter(c => c.startsWith('/rex'))
  expect(doHii.length).toBe(2)
  expect(daIa.length).toBeLessThan(doHii.length)
  expect(daIa).toEqual(['/rex1'])
})

test('REGRESSAO com um unico match do hii nao ha espaco para a ia — maioria estrita exige isso', () => {
  const comIa = { ...ctx, comandosDaIa: ['/helpme'] }
  expect(complete('/he', comIa)[0]).toEqual(['/help'])
})

test('sem match do hii, os comandos da ia aparecem sozinhos', () => {
  const comIa = { ...ctx, comandosDaIa: ['/xa', '/xb'] }
  expect(complete('/x', comIa)[0]).toEqual(['/xa', '/xb'])
})

test('comando da ia que colide com um comando do hii nao aparece duplicado', () => {
  const comIa = { ...ctx, comandosDaIa: ['/config'] }
  expect(complete('/c', comIa)[0]).toEqual(['/config'])
})

test('sem comandosDaIa no contexto, o comportamento e identico ao de antes', () => {
  expect(complete('/re', ctx)[0]).toEqual(['/ref', '/repo'])
})

// O "+more" era beco sem saida por DOIS motivos, e este e o segundo: quando a ia
// aparecia sozinha (sem match do hii), a lista era cortada em 6 AQUI — o dado
// chegava truncado no renderizador, e navegar nunca alcançava o resto.
test('ia sozinha NAO tem teto arbitrario — a navegacao tem de alcancar tudo', () => {
  const muitos = Array.from({ length: 25 }, (_, i) => `/x${String(i).padStart(2, '0')}`)
  const r = complete('/x', { ...ctx, comandosDaIa: muitos })[0]
  expect(r.length, 'cortar aqui fazia o "e mais N" contar um resto inalcancavel').toBe(25)
})

test('mas a MAIORIA ESTRITA do hii continua valendo quando ha match dos dois', () => {
  const muitos = Array.from({ length: 25 }, (_, i) => `/rex${i}`)
  const r = complete('/re', { ...ctx, comandosDaIa: muitos })[0]
  const doHii = r.filter(c => ['/ref', '/repo'].includes(c))
  const daIa = r.filter(c => c.startsWith('/rex'))
  expect(doHii.length).toBe(2)
  expect(daIa.length, 'o que o harness expoe nao pode afogar os comandos do motor').toBeLessThan(doHii.length)
})
