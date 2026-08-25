import { test, expect } from '../apoio/runner.ts'
import { readFileSync } from 'node:fs'
import {
  propostasNumeradas, promptDoCritico, parseVoto, convergir, lentesDeCriterio, idsDosCriticos,
} from '../../motor/cic/mcn/convergir.ts'
import type { Voto } from '../../motor/cic/vto.ts'
import type { Proposta } from '../../motor/cic/mcn/divergir.ts'

const PROPOSTAS: Proposta[] = [
  { enquadramento: 'inversao', texto: 'cache por no com invalidacao por evento' },
  { enquadramento: 'atacante', texto: 'cache central com lock otimista' },
  { enquadramento: 'plantao', texto: 'sem cache, com indice coberto no banco' },
]
const LISTA = propostasNumeradas(PROPOSTAS)

function votos(pares: Array<[string, number]>): Voto[] {
  return pares.map(([lente, n]) => ({ lente, escolha: LISTA[n - 1]?.texto ?? '', porque: 'porque sim' }))
}

test('os candidatos sao numerados a partir de 1 — o critico responde por numero', () => {
  expect(LISTA.map(c => c.n)).toEqual([1, 2, 3])
  expect(LISTA[0]?.texto).toBe(PROPOSTAS[0]?.texto)
})

test('NENHUM JUIZ NOVO os criticos sao os criterios escritos do CRV', () => {
  const lentes = lentesDeCriterio()
  expect(lentes.length).toBeGreaterThan(1)
  expect(lentes.map(l => l.id)).toEqual(idsDosCriticos())
  // Se alguem trocar o CRV por uma lista local, este teste cai junto.
  for (const l of lentes) {
    expect(l.checa.trim().length, `criterio "${l.id}" sem "checa"`).toBeGreaterThan(0)
  }
})

test('NENHUM JUIZ NOVO convergir.ts nao reimplementa contagem — delega a VTO e RDA', () => {
  const fonte = readFileSync('motor/cic/mcn/convergir.ts', 'utf8')
  expect(fonte).toContain("from '../vto.ts'")
  expect(fonte).toContain("from '../rda.ts'")
  // Contagem propria aqui criaria um segundo placar que envelheceria calado
  // quando o VTO mudasse.
  expect(fonte).not.toMatch(/new Map<string, number>/)
})

test('o critico e instruido a nao ter apego e a julgar por UM criterio', () => {
  const c = lentesDeCriterio()[0]
  expect(c).toBeDefined()
  if (!c) return
  const p = promptDoCritico('o enunciado', LISTA, c)
  expect(p).toContain('NAO gerou nenhuma destas propostas')
  expect(p).toContain(c.id)
  expect(p).toContain('nao a melhor no geral')
  // Abster tem de ser oferecido, senao o critico elege a menos ruim.
  expect(p).toContain('abster')
})

test('voto ilegivel vira ABSTENCAO, nunca voto no primeiro candidato', () => {
  expect(parseVoto('sem json nenhum', 'c-erro', LISTA)).toBeNull()
  expect(parseVoto('{"escolha": 0}', 'c-erro', LISTA)).toBeNull()
  expect(parseVoto('{"escolha": 99}', 'c-erro', LISTA)).toBeNull()
  expect(parseVoto('{"escolha": "duas"}', 'c-erro', LISTA)).toBeNull()
})

test('voto valido aponta o texto do candidato, nao o numero', () => {
  const v = parseVoto('{"escolha": 2, "porque": "mais simples"}', 'c-erro', LISTA)
  expect(v?.escolha).toBe(LISTA[1]?.texto)
  expect(v?.lente).toBe('c-erro')
  expect(v?.porque).toBe('mais simples')
})

test('votacao vazia NAO vira aprovacao por omissao', () => {
  const r = convergir([], LISTA, 3, ['c-erro'])
  expect(r.houveVeredicto).toBe(false)
  expect(r.escolhido).toBeNull()
  expect(r.motivo).toContain('sem voto nao ha veredicto')
  expect(r.abstencoes).toBe(3)
})

test('EMPATE nao elege ninguem — o MCN nao desempata sozinho', () => {
  const r = convergir(votos([['a', 1], ['b', 2]]), LISTA, 0, ['a', 'b'])
  expect(r.houveVeredicto).toBe(false)
  expect(r.escolhido).toBeNull()
  expect(r.motivo).toContain('decisao humana')
  expect(r.apuracao?.empate).toBe(true)
})

test('maioria simples abaixo do consenso minimo nao fecha, e nomeia quem divergiu', () => {
  // 2 de 4 = 50%, abaixo dos dois tercos. Com 3 eleitores em 3 candidatos seria
  // EMPATE, que e outro caso — o de cima.
  const r = convergir(votos([['a', 1], ['b', 1], ['c', 2], ['d', 3]]), LISTA, 0, ['a', 'b', 'c', 'd'])
  expect(r.houveVeredicto).toBe(false)
  expect(r.consenso?.houve).toBe(false)
  expect(r.motivo).toContain('abaixo do minimo')
  expect(r.consenso?.divergentes).toEqual(['c', 'd'])
})

test('consenso suficiente fecha, e o vencedor e o candidato de verdade', () => {
  const r = convergir(votos([['a', 2], ['b', 2], ['c', 2]]), LISTA, 0, ['a', 'b', 'c'])
  expect(r.houveVeredicto).toBe(true)
  expect(r.escolhido?.texto).toBe(LISTA[1]?.texto)
  expect(r.apuracao?.unanime).toBe(true)
  expect(r.consenso?.houve).toBe(true)
})

test('2 de 3 atinge o minimo de dois tercos e fecha, mas registra o divergente', () => {
  const r = convergir(votos([['a', 1], ['b', 1], ['c', 3]]), LISTA, 0, ['a', 'b', 'c'])
  expect(r.houveVeredicto).toBe(true)
  expect(r.apuracao?.unanime).toBe(false)
  expect(r.consenso?.divergentes).toEqual(['c'])
})

test('o mesmo criterio votando duas vezes LANCA — placar em dobro e placar falso', () => {
  const dobrado: Voto[] = [
    { lente: 'a', escolha: LISTA[0]?.texto ?? '', porque: 'x' },
    { lente: 'a', escolha: LISTA[0]?.texto ?? '', porque: 'y' },
  ]
  expect(() => convergir(dobrado, LISTA, 0, ['a'])).toThrow('votou duas vezes')
})

test('as abstencoes ficam no resultado — quantos criterios nao se pronunciaram importa', () => {
  const r = convergir(votos([['a', 1], ['b', 1], ['c', 1]]), LISTA, 5, ['a', 'b', 'c'])
  expect(r.abstencoes).toBe(5)
  expect(r.criteriosUsados).toEqual(['a', 'b', 'c'])
})
