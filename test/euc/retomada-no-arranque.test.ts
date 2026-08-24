import { test, expect, afterAll } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-retomada-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(join(process.env.HICODE_CARDS_DIR, 'runs'), { recursive: true })
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const { anexarEvento, eventosDoCard } = await import('../../motor/euc/eventos.ts')
const { retomarAoIniciar, faseInterrompida } = await import('../../motor/euc/recuperar.ts')

// A auditoria (Pluto + Crivo) achou que motor/euc/recuperar.ts era um modulo
// orfao: o item 26 da Onda 3 documenta retomarAoIniciar() rodando no arranque
// do daemon, mas a funcao nao existia e nada importava o modulo em producao —
// enquanto encerramento.ts e passo-com-gate.ts ja comentavam como se ela
// estivesse ativa.
test('INVARIANTE runner.ts chama retomarAoIniciar no arranque — senao o modulo e orfao', async () => {
  const fonte = await Bun.file('runner.ts').text()
  expect(fonte).toContain("from './motor/euc/recuperar.ts'")
  expect(fonte).toContain('retomarAoIniciar(')
  // Sem a guarda do -1, apagar `reconcileStranded()` do runner fazia a comparacao
  // virar `-1 < indice`, ou seja verdadeira, e o invariante de ORDEM passava com a
  // chamada AUSENTE.
  const iReconcile = fonte.indexOf('reconcileStranded()')
  const iRetomada = fonte.indexOf('retomarAoIniciar(')
  expect(iReconcile, 'reconcileStranded() sumiu do runner').toBeGreaterThan(-1)
  expect(iRetomada, 'retomarAoIniciar() sumiu do runner').toBeGreaterThan(-1)
  expect(iReconcile < iRetomada, 'a retomada tem de vir DEPOIS do reconcile, que decide o status do card').toBe(true)
})

test('fase aberta no crash e fechada no diario, com o motivo e o instante de abertura', () => {
  anexarEvento({ card: 'r1', evento: 'fase_inicio', fase: 'testes' })
  anexarEvento({ card: 'r1', evento: 'gate_start', fase: 'testes' })
  expect(faseInterrompida('r1')?.fase).toBe('testes')

  const linhas: string[] = []
  const retomados = retomarAoIniciar(l => linhas.push(l))

  expect(retomados.map(r => r.card)).toContain('r1')
  expect(faseInterrompida('r1'), 'a fase tem de deixar de ser reportada como aberta').toBeNull()
  // gate_start era o que estava aberto, entao quem fecha e gate_verdict.
  const fim = eventosDoCard('r1').filter(e => e.evento === 'gate_verdict').pop()
  expect(fim?.detalhe).toContain('interrompida por reinicio')
  expect(fim?.detalhe).toContain('gate_start')
  expect(linhas.join(' ')).toContain('#r1')
})

test('card ja fechado nao e retomado — o diario dele esta encerrado', () => {
  anexarEvento({ card: 'r2', evento: 'fase_inicio', fase: 'seguranca' })
  anexarEvento({ card: 'r2', evento: 'card_fechado' })
  expect(retomarAoIniciar().map(r => r.card)).not.toContain('r2')
})

test('card sem fase aberta nao gera evento nenhum — retomada nao suja o diario', () => {
  anexarEvento({ card: 'r3', evento: 'fase_inicio', fase: 'review' })
  anexarEvento({ card: 'r3', evento: 'fase_fim', fase: 'review', detalhe: 'aprovada' })
  const antes = eventosDoCard('r3').length
  expect(retomarAoIniciar().map(r => r.card)).not.toContain('r3')
  expect(eventosDoCard('r3').length).toBe(antes)
})

test('rodar duas vezes e idempotente — o segundo arranque nao reabre nada', () => {
  anexarEvento({ card: 'r4', evento: 'gate_start', fase: 'build' })
  expect(retomarAoIniciar().map(r => r.card)).toContain('r4')
  expect(retomarAoIniciar().map(r => r.card), 'reiniciar de novo nao pode refechar a mesma fase').not.toContain('r4')
})

test('o laco de ajuste de URL passou a registrar tentativa no diario', async () => {
  const { subirUrlComAjuste } = await import('../../motor/cic/rpr/url-ajuste.ts')
  let subidas = 0
  await subirUrlComAjuste({
    subir: (): Promise<number> => { subidas++; return Promise.resolve(0) },
    responde: (): Promise<boolean> => Promise.resolve(false),
    ajustar: (): Promise<string> => Promise.resolve('ajustou'),
  }, undefined, 'r5')
  expect(subidas).toBeGreaterThan(1)
  const tentativas = eventosDoCard('r5').filter(e => e.evento === 'repair_attempt')
  expect(tentativas.length, 'era o unico dos quatro lacos de reparo sem rastro no diario').toBeGreaterThan(0)
  expect(tentativas[0]?.fase).toBe('url')
})

test('sem card, o ajuste de URL continua funcionando e nao tenta escrever diario', async () => {
  const { subirUrlComAjuste } = await import('../../motor/cic/rpr/url-ajuste.ts')
  const r = await subirUrlComAjuste({
    subir: (): Promise<number> => Promise.resolve(0),
    responde: (): Promise<boolean> => Promise.resolve(false),
    ajustar: (): Promise<string> => Promise.resolve('ajustou'),
  })
  expect(r.noAr).toBe(false)
})

// O relato anterior varria de tras para frente e parava no PRIMEIRO evento de
// abertura. Com a fase externa aberta e uma interna JA FECHADA depois dela, ele
// respondia "nada interrompido" — crash durante o reparo era reportado como
// execucao intacta.
test('fase EXTERNA aberta nao e mascarada por uma fase interna que fechou depois', async () => {
  const { fasesInterrompidas } = await import('../../motor/euc/recuperar.ts')
  anexarEvento({ card: 'r-externa', evento: 'fase_inicio', fase: 'implementacao' })
  anexarEvento({ card: 'r-externa', evento: 'gate_start', fase: 'reparo' })
  anexarEvento({ card: 'r-externa', evento: 'gate_verdict', fase: 'reparo' })
  const abertas = fasesInterrompidas('r-externa')
  expect(abertas.map(a => a.fase), 'o gate fechou; a implementacao NAO').toEqual(['implementacao'])
  expect(faseInterrompida('r-externa')?.fase).toBe('implementacao')
})

test('retomada fecha TODAS as fases abertas, nao so a primeira — senao o card volta no proximo arranque', async () => {
  const { fasesInterrompidas } = await import('../../motor/euc/recuperar.ts')
  anexarEvento({ card: 'r-duas', evento: 'fase_inicio', fase: 'implementacao' })
  anexarEvento({ card: 'r-duas', evento: 'gate_start', fase: 'gate' })
  expect(fasesInterrompidas('r-duas').length).toBe(2)
  retomarAoIniciar(() => undefined)
  expect(fasesInterrompidas('r-duas'), 'sobrou fase aberta: o proximo arranque relataria o mesmo card').toEqual([])
})

test('com retry, dois `fase_inicio` da mesma fase NAO sao fechados pelo mesmo `fase_fim`', async () => {
  const { fasesInterrompidas } = await import('../../motor/euc/recuperar.ts')
  anexarEvento({ card: 'r-retry', evento: 'fase_inicio', fase: 'testes' })
  anexarEvento({ card: 'r-retry', evento: 'fase_fim', fase: 'testes' })
  expect(fasesInterrompidas('r-retry')).toEqual([])
  anexarEvento({ card: 'r-retry', evento: 'fase_inicio', fase: 'testes' })
  expect(fasesInterrompidas('r-retry').length, 'a segunda abertura precisa do proprio fechamento').toBe(1)
})
