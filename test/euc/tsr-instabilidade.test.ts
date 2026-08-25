import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-instab-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(join(process.env.HICODE_CARDS_DIR, 'runs'), { recursive: true })
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const I = await import('../../motor/euc/tsr/instabilidade.ts')
const { anexarEvento } = await import('../../motor/euc/eventos.ts')
const A = await import('../../motor/mir/acoes.ts')

function cardCom(repo: string, tentativas: number, fase: string): string {
  const id = A.submit({ title: `card de ${repo}`, repo, desc: 'x' })
  for (let i = 0; i < tentativas; i++) {
    anexarEvento({ card: id, evento: 'repair_attempt', fase, detalhe: `${i + 1}: nao resolveu` })
  }
  return id
}

test('sem reparo nenhum, nenhum alvo aparece — medir e mostrar, nao inventar', () => {
  expect(I.instabilidadePorAlvo()).toEqual([])
})

test('conta tentativa de reparo POR ALVO, somando os cards daquele alvo', () => {
  cardCom('org/instavel', 2, 'testes')
  cardCom('org/instavel', 3, 'conflito')
  cardCom('org/calmo', 1, 'testes')
  const medidas = I.instabilidadePorAlvo()
  const instavel = medidas.find(m => m.alvo === 'org/instavel')
  expect(instavel?.tentativas).toBe(5)
  expect(instavel?.cards).toBe(2)
  const calmo = medidas.find(m => m.alvo === 'org/calmo')
  expect(calmo?.tentativas).toBe(1)
})

test('separa por fase — saber SE reparou nao diz ONDE apertar o teto', () => {
  const medidas = I.instabilidadePorAlvo()
  const instavel = medidas.find(m => m.alvo === 'org/instavel')
  expect(instavel?.porFase.conflito).toBe(3)
  expect(instavel?.porFase.testes).toBe(2)
})

test('a ordem e do mais instavel para o menos — quem dói primeiro aparece primeiro', () => {
  const medidas = I.instabilidadePorAlvo()
  expect(medidas[0]?.alvo).toBe('org/instavel')
})

test('media por card e o numero que decide o teto, nao o total', () => {
  const instavel = I.instabilidadePorAlvo().find(m => m.alvo === 'org/instavel')
  expect(instavel?.mediaPorCard).toBeCloseTo(2.5, 5)
})

test('o relato diz o teto atual, senao o numero nao serve de decisao', () => {
  const r = I.relatoDeInstabilidade(I.instabilidadePorAlvo())
  expect(r).toContain('org/instavel')
  expect(r, 'sem o teto vigente ao lado, o operador nao sabe se 2,5 e muito').toContain('HICODE_REAJUSTE_RETRIES')
})

test('hii status mostra o reparo por alvo quando houver — numero sem quem ver nao decide nada', async () => {
  const { renderProgress } = await import('../../motor/euc/rdr/progresso.ts')
  const saida = renderProgress()
  expect(saida).toContain('reparo por alvo')
  expect(saida).toContain('org/instavel')
})
