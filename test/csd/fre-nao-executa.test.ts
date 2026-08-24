import { test, expect, afterAll } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-fre-gate-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(join(process.env.HICODE_CARDS_DIR, 'runs'), { recursive: true })
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const APR = await import('../../motor/csd/fre/aprendiz')
const C = await import('../../motor/csd/fre/candidatos')
const { anexarEvento, eventosDoCard } = await import('../../motor/euc/eventos')

function arquivosDoMotor(raiz = 'motor'): string[] {
  const fora: string[] = []
  for (const nome of readdirSync(raiz)) {
    const caminho = join(raiz, nome)
    if (statSync(caminho).isDirectory()) fora.push(...arquivosDoMotor(caminho))
    else if (nome.endsWith('.ts')) fora.push(caminho)
  }
  return fora
}

test('REGRA DE OURO nenhum candidato e lido de volta para dentro de prompt', () => {
  const todos = arquivosDoMotor()
  expect(todos.length).toBeGreaterThan(100)
  const permitidos = [join('motor', 'csd', 'fre', 'candidatos.ts'), join('motor', 'csd', 'fre', 'aprendiz.ts')]
  const leitores = todos
    .filter(f => !permitidos.includes(f))
    .filter(f => /candidatos\(|prontosParaRevisao\(|candidatos-regras/.test(readFileSync(f, 'utf8')))
  expect(leitores, 'candidato lido na mesma sessao que o gerou e memoria sem fronteira de confianca').toEqual([])
})

test('o aprendiz nao altera o estado do card — ele audita, nao decide', async () => {
  const alvo = join(BASE, 'alvo-1')
  anexarEvento({ card: 'apr-1', evento: 'gate_verdict', fase: 'seguranca', detalhe: 'reprovou: PaymentController sem teste de idempotencia' })
  const antes = eventosDoCard('apr-1').length
  await APR.aprendizFechaCard('apr-1', { alvo, dominio: 'laravel' })
  const eventos = eventosDoCard('apr-1')
  expect(eventos.filter(e => e.evento === 'gate_verdict').length, 'o aprendiz nao inventa veredicto').toBe(1)
  expect(eventos.length).toBeGreaterThan(antes)
})

test('o aprendiz extrai assinatura do DIARIO e registra candidato', async () => {
  const alvo = join(BASE, 'alvo-2')
  anexarEvento({ card: 'apr-2', evento: 'gate_verdict', fase: 'seguranca', detalhe: 'reprovou: PaymentController sem teste de idempotencia' })
  await APR.aprendizFechaCard('apr-2', { alvo, dominio: 'laravel' })
  const cs = C.candidatos(alvo)
  expect(cs.length).toBe(1)
  expect(cs[0]?.ocorrencias[0]?.card).toBe('apr-2')
})

test('gate que PASSOU nao gera candidato — so falha vira padrao', async () => {
  const alvo = join(BASE, 'alvo-3')
  anexarEvento({ card: 'apr-3', evento: 'gate_verdict', fase: 'seguranca', detalhe: 'ok' })
  await APR.aprendizFechaCard('apr-3', { alvo, dominio: 'laravel' })
  expect(C.candidatos(alvo)).toEqual([])
})

test('IDEMPOTENCIA o aprendiz roda uma vez por card, mesmo chamado duas vezes', async () => {
  const alvo = join(BASE, 'alvo-4')
  anexarEvento({ card: 'apr-4', evento: 'gate_verdict', fase: 'build', detalhe: 'falhou: composer sem autoload' })
  const um = await APR.aprendizFechaCard('apr-4', { alvo, dominio: 'laravel' })
  const dois = await APR.aprendizFechaCard('apr-4', { alvo, dominio: 'laravel' })
  expect(um.reaproveitada).toBe(false)
  expect(dois.reaproveitada, 'rodar de novo dobraria a contagem e falsearia o limiar').toBe(true)
  expect(C.candidatos(alvo)[0]?.ocorrencias.length).toBe(1)
})
