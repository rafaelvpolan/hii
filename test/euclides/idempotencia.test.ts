import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-idem-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(join(process.env.HICODE_CARDS_DIR, 'runs'), { recursive: true })
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const { executarComIdempotencia, chaveDeEfeito, efeitoJaProduzido } = await import('../../motor/quilombo/salvo-conduto/idempotencia.ts')
const { anexarEvento, eventosDoCard, arquivoDeEventos, ultimoEvento, cardFechado } = await import('../../motor/euclides/eventos.ts')

let seq = 0
function card(): string { return `idem-${++seq}` }

test('chave e composta e legivel — o diario e lido por humano quando um card trava', () => {
  expect(chaveDeEfeito('023', 'ctr', 'pr_create')).toBe('023:ctr:pr_create')
})

test('o efeito roda uma vez; a segunda chamada devolve o resultado gravado sem executar', async () => {
  const id = card()
  let execucoes = 0
  const op = {
    card: id, fase: 'ctr', operacao: 'pr_create',
    executar: (): Promise<string> => { execucoes++; return Promise.resolve('https://github.com/org/repo/pull/7') },
  }
  const a = await executarComIdempotencia(op)
  const b = await executarComIdempotencia(op)
  expect(execucoes).toBe(1)
  expect(a.reaproveitada).toBe(false)
  expect(b.reaproveitada).toBe(true)
  expect(b.resultado).toBe(a.resultado)
})

test('REGRESSAO efeito que NAO aconteceu nao e registrado — senao o retry nunca mais tentaria', async () => {
  const id = card()
  let execucoes = 0
  const falha = {
    card: id, fase: 'ctr', operacao: 'pr_create',
    executar: (): Promise<string> => { execucoes++; return Promise.resolve('') },
  }
  await executarComIdempotencia(falha)
  await executarComIdempotencia(falha)
  expect(execucoes, 'gh falhou duas vezes: as duas tentativas tem de rodar de verdade').toBe(2)
  expect(efeitoJaProduzido(id, 'ctr', 'pr_create')).toBeUndefined()

  const agora = await executarComIdempotencia({
    card: id, fase: 'ctr', operacao: 'pr_create',
    executar: (): Promise<string> => Promise.resolve('https://github.com/org/repo/pull/9'),
  })
  expect(agora.reaproveitada).toBe(false)
  expect(efeitoJaProduzido(id, 'ctr', 'pr_create')).toBe('https://github.com/org/repo/pull/9')
})

test('produziuEfeito customizado decide o que conta como efeito', async () => {
  const id = card()
  let execucoes = 0
  const op = {
    card: id, fase: 'ctr', operacao: 'webhook',
    executar: (): Promise<string> => { execucoes++; return Promise.resolve('0') },
    produziuEfeito: (r: string): boolean => r !== '0',
  }
  await executarComIdempotencia(op)
  await executarComIdempotencia(op)
  expect(execucoes).toBe(2)
})

test('cada operacao tem chave propria — um efeito nao mascara o outro', async () => {
  const id = card()
  const a = await executarComIdempotencia({ card: id, fase: 'ctr', operacao: 'pr_create', executar: (): Promise<string> => Promise.resolve('pr') })
  const b = await executarComIdempotencia({ card: id, fase: 'ctr', operacao: 'notificar', executar: (): Promise<string> => Promise.resolve('notif') })
  expect(a.resultado).toBe('pr')
  expect(b.resultado).toBe('notif')
  expect(b.reaproveitada).toBe(false)
})

test('o diario e append-only: gravar de novo acrescenta linha, nunca reescreve', () => {
  const id = card()
  anexarEvento({ card: id, evento: 'gate_start', fase: 'testes' })
  anexarEvento({ card: id, evento: 'gate_verdict', fase: 'testes', detalhe: 'ok' })
  const eventos = eventosDoCard(id)
  expect(eventos.map(e => e.evento)).toEqual(['gate_start', 'gate_verdict'])
  expect(ultimoEvento(id)?.detalhe).toBe('ok')
})

test('linha corrompida no fim do arquivo nao derruba a leitura do diario', () => {
  const id = card()
  anexarEvento({ card: id, evento: 'gate_start', fase: 'testes' })
  appendFileSync(arquivoDeEventos(id), '{"card":"' + id + '","evento":"gate_ver')
  anexarEvento({ card: id, evento: 'card_fechado' })
  expect(eventosDoCard(id).map(e => e.evento)).toEqual(['gate_start', 'card_fechado'])
  expect(cardFechado(id)).toBe(true)
})

test('evento de tipo desconhecido e descartado — o diario nao aceita qualquer coisa', () => {
  const id = card()
  appendFileSync(arquivoDeEventos(id), JSON.stringify({ ts: 'x', card: id, evento: 'inventado' }) + '\n')
  anexarEvento({ card: id, evento: 'gate_start' })
  expect(eventosDoCard(id).map(e => e.evento)).toEqual(['gate_start'])
})

test('card sem diario devolve lista vazia, nao erro', () => {
  expect(eventosDoCard('nunca-existiu')).toEqual([])
  expect(ultimoEvento('nunca-existiu')).toBeNull()
  expect(cardFechado('nunca-existiu')).toBe(false)
})
