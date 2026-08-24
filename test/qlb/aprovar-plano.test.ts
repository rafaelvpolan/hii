import { test, expect, afterAll } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-parede-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(join(process.env.HICODE_CARDS_DIR, 'runs'), { recursive: true })
delete process.env.HICODE_RIGOR_ESTRITO
afterAll(() => {
  rmSync(BASE, { recursive: true, force: true })
  delete process.env.HICODE_RIGOR_ESTRITO
})

const { conferirParedeDoPlano, prepararMatriz } = await import('../../motor/qlb/ctr/aprovar-plano.ts')
const A = await import('../../motor/mir/acoes.ts')
const { readCard } = await import('../../motor/cdl/store.ts')
const { SECOES_DA_MATRIZ, arquivoDaMatriz, criarMatriz } = await import('../../motor/nmy/luc/matriz-entendimento.ts')

function novo(): string {
  return A.submit({ title: 'cobrar comissao', repo: 'org/app', desc: 'calcular comissao por corte' })
}

function escreverMatriz(card: string, corpo: string): void {
  mkdirSync(dirname(arquivoDaMatriz(card)), { recursive: true })
  writeFileSync(arquivoDaMatriz(card), corpo)
}

function responderTudo(card: string): void {
  escreverMatriz(card, SECOES_DA_MATRIZ.map(s => `## ${s.titulo}\n\nresposta de verdade para a secao ${s.id}\n`).join('\n'))
}

function comRigorEstrito<T>(fn: () => T): T {
  process.env.HICODE_RIGOR_ESTRITO = '1'
  try {
    return fn()
  } finally {
    delete process.env.HICODE_RIGOR_ESTRITO
  }
}

test('sem matriz a parede nao esta satisfeita, e o motivo diz onde responder', () => {
  const p = conferirParedeDoPlano('parede-sem')
  expect(p.satisfeito).toBe(false)
  expect(p.motivo).toContain('matriz-entendimento-parede-sem.md')
})

test('o template recem-criado nao satisfaz a parede — existir nao e responder', async () => {
  await criarMatriz('parede-template', 'cobrar comissao')
  expect(conferirParedeDoPlano('parede-template').satisfeito).toBe(false)
})

test('matriz respondida satisfaz a parede', () => {
  responderTudo('parede-cheia')
  const p = conferirParedeDoPlano('parede-cheia')
  expect(p.satisfeito).toBe(true)
  expect(p.motivo).toContain('completa')
})

test('matriz incompleta nomeia a secao que falta, para o humano saber o que escrever', () => {
  escreverMatriz('parede-meia', SECOES_DA_MATRIZ
    .map(s => (s.id === 'borda' ? `## ${s.titulo}\n` : `## ${s.titulo}\n\nresposta de verdade\n`))
    .join('\n'))
  const p = conferirParedeDoPlano('parede-meia')
  expect(p.satisfeito).toBe(false)
  expect(p.motivo).toContain('Casos de borda')
})

test('COM rigor estrito approvePlan RECUSA sem matriz, e o card nao sai de READY', () => {
  const id = novo()
  const r = comRigorEstrito(() => A.approvePlan(id))
  expect(r.ok).toBe(false)
  expect(r.reason).toContain('matriz')
  expect(readCard(id)?.fm.status, 'recusar tem de deixar o card onde estava').toBe('READY')
})

test('COM rigor estrito e matriz respondida, approvePlan aprova', () => {
  const id = novo()
  responderTudo(id)
  const r = comRigorEstrito(() => A.approvePlan(id))
  expect(r.ok).toBe(true)
  expect(readCard(id)?.fm.status).toBe('EXECUTING')
})

test('SEM rigor estrito approvePlan aprova, mas deixa registrado que passou sem matriz', () => {
  const id = novo()
  const r = A.approvePlan(id)
  expect(r.ok, 'desligado, a parede so observa').toBe(true)
  const c = readCard(id)
  expect(c?.fm.status).toBe('EXECUTING')
  expect(c?.fm.matriz_entendimento, 'quem passou sem provar tem de ficar visivel').toBe('incompleta')
})

test('SEM rigor estrito e matriz respondida, o card registra ok', () => {
  const id = novo()
  responderTudo(id)
  A.approvePlan(id)
  expect(readCard(id)?.fm.matriz_entendimento).toBe('ok')
})

test('a recusa diz POR QUE recusou — o chamador nao deduz a causa por heuristica', () => {
  const semMatriz = comRigorEstrito(() => A.approvePlan(novo()))
  expect(semMatriz.motivo).toBe('parede')

  const jaExecutou = novo()
  A.transition(jaExecutou, 'URL')
  expect(A.approvePlan(jaExecutou).motivo).toBe('estado')

  expect(A.approvePlan('card-que-nao-existe').motivo).toBe('nao-encontrado')
})

test('INVARIANTE o CLI usa o motivo estruturado, nao infere a causa de duas condicoes soltas', async () => {
  const fonte = await Bun.file('bin/hii.ts').text()
  expect(fonte).toContain("=== 'parede'")
  expect(fonte, 'deduzir a causa por !ok + id preenchido quebra quando surgir outra pre-condicao').not.toContain("!r.ok && r.id !== ''")
})

test('prepararMatriz cria o template do card e devolve o veredicto, ainda incompleto', async () => {
  const id = novo()
  const r = await prepararMatriz(id)
  expect(r.ok).toBe(true)
  expect(r.caminho).toContain(`matriz-entendimento-${id}.md`)
  expect(r.parede.satisfeito, 'template nao e resposta').toBe(false)
  expect(r.relato).toContain('falta responder')
})

test('prepararMatriz recusa card inexistente em vez de criar matriz orfa', async () => {
  const r = await prepararMatriz('card-fantasma')
  expect(r.ok).toBe(false)
  expect(r.relato).toContain('card-fantasma')
  const { existsSync } = await import('node:fs')
  expect(existsSync(arquivoDaMatriz('card-fantasma')), 'nao pode sobrar arquivo de card que nao existe').toBe(false)
})

test('prepararMatriz duas vezes nao sobrescreve o que o humano respondeu', async () => {
  const id = novo()
  await prepararMatriz(id)
  responderTudo(id)
  const r = await prepararMatriz(id)
  expect(r.parede.satisfeito).toBe(true)
  expect(r.relato).toContain('completa')
})

async function corpoDeApprovePlan(): Promise<string> {
  const fonte = await Bun.file('motor/mir/acoes.ts').text()
  const inicio = fonte.indexOf('export function approvePlan')
  expect(inicio, 'approvePlan sumiu de acoes.ts').toBeGreaterThan(-1)
  const fim = fonte.indexOf('\n}', inicio)
  expect(fim, 'nao achei o fim de approvePlan').toBeGreaterThan(inicio)
  return fonte.slice(inicio, fim)
}

test('INVARIANTE approvePlan consulta a parede ANTES de transicionar', async () => {
  const corpo = await corpoDeApprovePlan()
  expect(corpo).toContain('conferirParedeDoPlano(id)')
  const antes = corpo.indexOf('conferirParedeDoPlano(id)') < corpo.indexOf("transition(id, 'EXECUTING'")
  expect(antes, 'consultar depois da transicao nao barraria nada').toBe(true)
})

test('INVARIANTE a recusa acontece dentro de approvePlan, nao em outro caminho', async () => {
  const corpo = await corpoDeApprovePlan()
  expect(corpo, 'a barreira tem de morar no mesmo lugar que decide aprovar').toContain('rigorEstrito()')
})

test('INVARIANTE a barreira so fecha com rigorEstrito — a politica das ondas 5 e 7 e a mesma', async () => {
  const fonte = await Bun.file('motor/mir/acoes.ts').text()
  expect(fonte).toContain('rigorEstrito()')
  expect(fonte, 'o veredicto tem de ir para o card mesmo quando nao barra').toContain('matriz_entendimento')
})
