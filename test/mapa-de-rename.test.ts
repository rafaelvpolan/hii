import { test, expect } from 'bun:test'
// hicode:allow-any — o script de rename e .mjs sem tipos; a fronteira e checada aqui.
import {
  lerMapaDoDoc,
  expandir,
  conferirEstado,
  dominioDe,
  TOTAL_ESPERADO,
} from '../scripts/renomear-brazil.mjs'

const todos: [string, string][] = expandir(lerMapaDoDoc())

test('o mapa de rename cobre exatamente os arquivos declarados no doc', () => {
  expect(todos.length).toBe(TOTAL_ESPERADO)
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
  expect(estado.origem.length + estado.destino.length).toBe(TOTAL_ESPERADO)
})

test('os dez dominios da Onda 1 tem a contagem que o workflow declara', () => {
  const esperado: Record<string, number> = {
    mir: 57, tmd: 25, cdl: 20, euc: 18, qlb: 17,
    cic: 12, osw: 9, nmy: 7, agentes: 6, csd: 1,
  }
  const real: Record<string, number> = {}
  for (const [, destino] of todos) {
    const d = dominioDe(destino)
    real[d] = (real[d] ?? 0) + 1
  }
  expect(real).toEqual(esperado)
})
