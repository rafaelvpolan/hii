import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-crivo-q-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(join(process.env.HICODE_CARDS_DIR, 'runs'), { recursive: true })
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const { createCard, readCard, patchCard } = await import('../../motor/cdl/store.ts')
const { perguntasDoCrivo, temPerguntaAberta, linhasParaOPr } = await import('../../motor/cic/crv/perguntas-do-crivo.ts')
const { pendencia, responder } = await import('../../motor/mir/responder.ts')
const { pendenciaDoStatus } = await import('../../motor/mir/render/pendencia.ts')

// As tres perguntas reais do card 001, que ficaram invisiveis no frontmatter.
const TRES = [
  'package.json e o lockfile foram alterados nesta branch para adicionar vitest, ou o pacote ja existia?',
  'Voce rodou "vitest run" e viu as 12+ asercoes passarem em verde, ou so leu o arquivo?',
  'vite.config.ts ganhou plugin novo — isso foi validado com um build real?',
]

function cardComPerguntas(status = 'HALTED'): string {
  const id = createCard({ title: 'verificar problemas de seo', status, repo: 'org/site' }, '## Objetivo\nseo\n')
  patchCard(id, { review_verdict: 'CONDITIONAL', review_questions: JSON.stringify(TRES) })
  return id
}

// O DEFEITO: `persistGate` gravava `review_questions` e o motor inteiro nao tinha um
// leitor. O card parava com as perguntas dentro do frontmatter, e a TUI dizia so
// "a tarefa parou — enter retoma".
test('REGRESSAO: pergunta do crivo vira pendencia visivel, e nao texto morto no card', () => {
  const id = cardComPerguntas()
  const card = readCard(id)
  expect(card, 'card criado').toBeDefined()
  expect(temPerguntaAberta(card?.fm ?? {}, id), 'o motor tem de VER a pergunta').toBe(true)
  expect(perguntasDoCrivo(card?.fm ?? {}, id).length).toBe(3)

  const p = pendencia(id)
  expect(p, 'sem pendencia, a TUI nao entra no modo de resposta').not.toBeNull()
  expect(p?.origem).toBe('crivo')
  expect(p?.atual.q).toContain('package.json')
  expect(p?.atual.options.length, 'sem opcao, responder exigiria digitar frase inteira').toBe(3)
})

test('REGRESSAO: a pendencia ANUNCIA a pergunta em vez de so dizer que a tarefa parou', () => {
  const semPergunta = pendenciaDoStatus('HALTED', '1', false)
  expect(semPergunta?.titulo).toContain('parou')
  const comPergunta = pendenciaDoStatus('HALTED', '1', true)
  expect(comPergunta?.titulo, 'quem opera precisa saber que ha pergunta').toContain('crivo perguntou')
  expect(comPergunta?.acoes.some(a => a.tecla === 'numero'), 'e como responder').toBe(true)
})

// A pergunta do crivo aparece em QUALQUER status: ela e sobre o que ja foi feito.
test('a pergunta vence o status — vale em HALTED, URL e PR_OPEN', () => {
  for (const status of ['HALTED', 'URL', 'PR_OPEN', 'URL_OK']) {
    expect(pendenciaDoStatus(status, '1', true)?.titulo, status).toContain('crivo perguntou')
  }
})

test('responder grava a resposta e caminha para a proxima', () => {
  const id = cardComPerguntas()
  const r1 = responder(id, '1')
  expect(r1.ok, r1.reason).toBe(true)
  expect(r1.resposta).toBe('sim')
  expect(r1.restantes, 'faltam duas').toBe(2)
  expect(r1.retomou, 'pergunta do crivo NAO retoma o card — a decisao segue do humano').toBe(false)
  expect(pendencia(id)?.indice, 'a segunda pergunta assume').toBe(1)

  const diario = readCard(id)?.body ?? ''
  expect(diario, 'a resposta tem de ficar auditavel').toContain('resposta ao crivo')
  expect(diario).toContain('sim')
})

test('texto livre tambem responde — as opcoes nao sao camisa de forca', () => {
  const id = cardComPerguntas()
  const r = responder(id, 'o lockfile ja tinha vitest desde a semana passada')
  expect(r.ok).toBe(true)
  expect(r.resposta).toContain('lockfile ja tinha')
})

test('respondidas todas, o card marca e a pendencia some', () => {
  const id = cardComPerguntas()
  responder(id, '1'); responder(id, '2'); responder(id, '3')
  expect(pendencia(id), 'nada mais a responder').toBeNull()
  expect(readCard(id)?.fm.review_respondido).toBe('sim')
  expect(temPerguntaAberta(readCard(id)?.fm ?? {}, id)).toBe(false)
})

// A resposta tem de CHEGAR a algum lugar que importe, senao e outro valor calculado
// e nunca aplicado — o defeito que este arquivo inteiro conserta.
test('a resposta entra no corpo do PR, no lugar da caixa vazia', () => {
  const id = cardComPerguntas()
  responder(id, '1')
  const linhas = linhasParaOPr(id, TRES)
  expect(linhas[0], 'respondida vira marcada e mostra a resposta').toContain('[x]')
  expect(linhas[0]).toContain('respondido:')
  expect(linhas[1], 'nao respondida segue como caixa vazia').toContain('[ ]')
})

// Rodada nova do crivo troca as perguntas: resposta velha nao pode ser herdada por
// pergunta que ninguem fez.
test('pergunta nova nao herda resposta de pergunta que nao existe mais', () => {
  const id = cardComPerguntas()
  responder(id, '1')
  patchCard(id, { review_questions: JSON.stringify(['o build de producao roda sem erro?']) })
  const perguntas = perguntasDoCrivo(readCard(id)?.fm ?? {}, id)
  expect(perguntas.length).toBe(1)
  expect(perguntas[0]?.answer, 'resposta de outra pergunta nao vale para esta').toBeUndefined()
  expect(temPerguntaAberta(readCard(id)?.fm ?? {}, id)).toBe(true)
})

test('card sem pergunta do crivo segue exatamente como antes', () => {
  const id = createCard({ title: 'sem pergunta', status: 'HALTED', repo: 'org/site' }, '## Objetivo\nx\n')
  expect(temPerguntaAberta(readCard(id)?.fm ?? {}, id)).toBe(false)
  expect(pendencia(id)).toBeNull()
  expect(pendenciaDoStatus('HALTED', id, false)?.titulo).toContain('parou')
})

test('review_questions corrompido nao derruba a TUI', () => {
  const id = createCard({ title: 'corrompido', status: 'HALTED', repo: 'org/site' }, '## Objetivo\nx\n')
  patchCard(id, { review_questions: '{{{nao e json' })
  expect(() => perguntasDoCrivo(readCard(id)?.fm ?? {}, id)).not.toThrow()
  expect(perguntasDoCrivo(readCard(id)?.fm ?? {}, id)).toEqual([])
})
