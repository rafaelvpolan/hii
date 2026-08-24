import { test, expect } from 'bun:test'

const VTO = await import('../../motor/cic/vto.ts')
const RDA = await import('../../motor/cic/rda.ts')

const voto = (lente: string, escolha: string) => ({ lente, escolha, porque: `${lente} preferiu ${escolha}` })

test('maioria simples vence, e a apuracao diz quantos votos', () => {
  const a = VTO.apurar([voto('correcao', 'A'), voto('risco', 'A'), voto('estetica', 'B')])
  expect(a.vencedor).toBe('A')
  expect(a.votos).toBe(2)
  expect(a.total).toBe(3)
  expect(a.unanime).toBe(false)
})

test('unanimidade e marcada — nao e a mesma coisa que maioria apertada', () => {
  const a = VTO.apurar([voto('correcao', 'A'), voto('risco', 'A')])
  expect(a.unanime).toBe(true)
})

test('EMPATE nao escolhe ninguem — desempatar sozinho seria inventar veredicto', () => {
  const a = VTO.apurar([voto('correcao', 'A'), voto('estetica', 'B')])
  expect(a.empate).toBe(true)
  expect(a.vencedor, 'empate com vencedor e decisao fabricada').toBe('')
})

test('apuracao sem voto nenhum LANCA — votacao vazia aprovando qualquer coisa e guarda vazia', () => {
  expect(() => VTO.apurar([])).toThrow('sem voto')
})

test('duas lentes com o mesmo nome LANCAM — o mesmo critico votando duas vezes falseia o placar', () => {
  expect(() => VTO.apurar([voto('risco', 'A'), voto('risco', 'B')])).toThrow('risco')
})

test('consenso mede a fracao que concorda e nomeia quem divergiu', () => {
  const c = RDA.consenso([voto('correcao', 'A'), voto('risco', 'A'), voto('estetica', 'B')])
  expect(c.nivel).toBeCloseTo(2 / 3, 5)
  expect(c.divergentes).toEqual(['estetica'])
})

test('consenso abaixo do minimo nao houve — e o padrao exige mais que maioria simples', () => {
  const c = RDA.consenso([voto('correcao', 'A'), voto('risco', 'B')])
  expect(c.houve).toBe(false)
})

test('consenso unanime houve, sem divergentes', () => {
  const c = RDA.consenso([voto('correcao', 'A'), voto('risco', 'A'), voto('estetica', 'A')])
  expect(c.houve).toBe(true)
  expect(c.divergentes).toEqual([])
})

test('escolha vazia LANCA — string vazia e o sinal de empate, nao um candidato', () => {
  expect(() => VTO.apurar([voto('correcao', ''), voto('risco', 'A')])).toThrow('vazia')
})
