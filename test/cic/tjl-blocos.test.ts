import { test, expect, afterAll } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-tjl-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(join(process.env.HICODE_CARDS_DIR, 'runs'), { recursive: true })
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const { executarEmBlocos, relatoDosBlocos } = await import('../../motor/nmy/tjl/blocos')
const { APROVADO, reprovado } = await import('../../motor/cic/reparo')
const { eventosDoCard } = await import('../../motor/euc/eventos')

function blocos(falhaEm: string | null): Parameters<typeof executarEmBlocos>[0] {
  return ['schema', 'migration', 'model', 'controller', 'teste'].map(id => ({
    id,
    instrucao: `faca o ${id}`,
    validar: () => Promise.resolve(id === falhaEm ? reprovado(`${id} nao compila`) : APROVADO),
  }))
}

test('todos os blocos validando, a execucao conclui na ordem', async () => {
  const rodados: string[] = []
  const r = await executarEmBlocos(blocos(null), b => { rodados.push(b.id); return Promise.resolve() })
  expect(r.concluido).toBe(true)
  expect(rodados).toEqual(['schema', 'migration', 'model', 'controller', 'teste'])
  expect(r.naoExecutados).toEqual([])
})

test('REGRESSAO bloco que nao valida para tudo — os seguintes NAO rodam', async () => {
  const rodados: string[] = []
  const r = await executarEmBlocos(blocos('migration'), b => { rodados.push(b.id); return Promise.resolve() })
  expect(rodados, 'gerou em cima de uma base quebrada').toEqual(['schema', 'migration'])
  expect(r.concluido).toBe(false)
  expect(r.pararEm).toBe('migration')
  expect(r.naoExecutados).toEqual(['model', 'controller', 'teste'])
})

test('o relato diz quantos blocos foram poupados — e disso que vem a economia', async () => {
  const r = await executarEmBlocos(blocos('schema'), () => Promise.resolve())
  const texto = relatoDosBlocos(r)
  expect(texto).toContain('parou no bloco "schema"')
  expect(texto).toContain('4 bloco(s) nao chegaram a rodar')
})

test('cada bloco abre e fecha fase no diario, e o bloco que falha fecha com o status', async () => {
  await executarEmBlocos(blocos('model'), () => Promise.resolve(), 'card-tjl')
  const eventos = eventosDoCard('card-tjl')
  const fases = eventos.filter(e => e.evento === 'fase_inicio').map(e => e.fase)
  expect(fases).toEqual(['bloco:schema', 'bloco:migration', 'bloco:model'])
  const ultimo = eventos.filter(e => e.evento === 'fase_fim').pop()
  expect(ultimo?.fase).toBe('bloco:model')
  expect(ultimo?.detalhe).toBe('falhou')
})

test('lista vazia conclui sem executar nada', async () => {
  const r = await executarEmBlocos([], () => Promise.reject(new Error('nao deveria executar')))
  expect(r.concluido).toBe(true)
  expect(r.executados).toEqual([])
})

test('o primeiro bloco falhando nao executa nenhum outro', async () => {
  const rodados: string[] = []
  await executarEmBlocos(blocos('schema'), b => { rodados.push(b.id); return Promise.resolve() })
  expect(rodados).toEqual(['schema'])
})
