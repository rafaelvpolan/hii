import { test, expect, beforeEach } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChamadaDeIa, PapelDeChamada } from '../lib/card/types'

let estado = ''

beforeEach(async () => {
  estado = mkdtempSync(join(tmpdir(), 'hii-ias-'))
  mkdirSync(join(estado, 'runs'), { recursive: true })
  process.env.HICODE_CARDS_DIR = estado
  const { esquecerSessoes } = await import('../lib/runner/ias-da-sessao')
  esquecerSessoes()
})

function chamada(over: Partial<ChamadaDeIa> = {}): ChamadaDeIa {
  return {
    ts: '2026-08-19T12:00:00Z',
    papel: 'implement' as PapelDeChamada,
    provedor: 'claude',
    modelo: 'opus-5',
    custoUsd: 0.1,
    custoMedido: true,
    tokens: 1000,
    duracaoS: 10,
    ok: true,
    ...over,
  }
}

test('a sessao de um card e estavel entre chamadas, e uma nova execucao abre outra', async () => {
  const m = await import('../lib/runner/ias-da-sessao')
  const primeira = m.abrirSessao('010', Date.parse('2026-08-19T12:00:00Z'))
  expect(m.sessaoDoCard('010')).toBe(primeira)
  expect(m.sessaoDoCard('010')).toBe(primeira)
  const segunda = m.abrirSessao('010', Date.parse('2026-08-19T13:00:00Z'))
  expect(segunda).not.toBe(primeira)
  expect(m.sessaoDoCard('010')).toBe(segunda)
})

test('o id curto e deterministico — mesma sessao, mesmo id', async () => {
  const { idCurto } = await import('../lib/runner/ias-da-sessao')
  expect(idCurto('010-20260819120000')).toBe(idCurto('010-20260819120000'))
  expect(idCurto('010-20260819120000')).not.toBe(idCurto('010-20260819130000'))
  expect(idCurto('010-20260819120000').length).toBe(4)
})

test('cada chamada vira uma linha do ledger, em ordem', async () => {
  const m = await import('../lib/runner/ias-da-sessao')
  const sessao = m.abrirSessao('010')
  m.registrarChamada(sessao, chamada({ papel: 'implement' }))
  m.registrarChamada(sessao, chamada({ papel: 'gate', provedor: 'codex' }))
  const linhas = readFileSync(m.arquivoDoLedger(sessao), 'utf8').trim().split('\n')
  expect(linhas.length).toBe(2)
  const lidas = m.chamadasDaSessao(sessao)
  expect(lidas.map(c => c.papel)).toEqual(['implement', 'gate'])
  expect(lidas.map(c => c.provedor)).toEqual(['claude', 'codex'])
})

test('linha corrompida no ledger nao derruba a leitura das outras', async () => {
  const m = await import('../lib/runner/ias-da-sessao')
  const sessao = m.abrirSessao('010')
  m.registrarChamada(sessao, chamada())
  writeFileSync(m.arquivoDoLedger(sessao), `${readFileSync(m.arquivoDoLedger(sessao), 'utf8')}{isto nao e json}\n`)
  m.registrarChamada(sessao, chamada({ papel: 'gate' }))
  expect(m.chamadasDaSessao(sessao).length).toBe(2)
})

test('papel desconhecido no disco nao vira papel invalido em memoria', async () => {
  const m = await import('../lib/runner/ias-da-sessao')
  const sessao = m.abrirSessao('010')
  writeFileSync(m.arquivoDoLedger(sessao), `${JSON.stringify({ papel: 'inventado', provedor: 'x' })}\n`)
  expect(m.chamadasDaSessao(sessao)[0]?.papel).toBe('desconhecido')
})

test('O CASO DO GATED STEP: duas IAs no mesmo passo aparecem separadas, nao somadas', async () => {
  const { agregarPorIa } = await import('../lib/runner/ias-da-sessao')
  const ias = agregarPorIa([
    chamada({ papel: 'step', provedor: 'claude', custoUsd: 0.2, tokens: 2000 }),
    chamada({ papel: 'gate', provedor: 'codex', modelo: 'gpt-5', custoUsd: 0.05, tokens: 500 }),
  ])
  expect(ias.length).toBe(2)
  expect(ias.map(i => i.rotulo)).toEqual(['revisa', 'poli'])
  expect(ias.find(i => i.papel === 'gate')?.provedor).toBe('codex')
  expect(ias.find(i => i.papel === 'step')?.custoUsd).toBe(0.2)
})

test('chamadas do mesmo papel, provedor e modelo somam numa linha so', async () => {
  const { agregarPorIa } = await import('../lib/runner/ias-da-sessao')
  const ias = agregarPorIa([
    chamada({ custoUsd: 0.1, tokens: 1000, duracaoS: 10 }),
    chamada({ custoUsd: 0.2, tokens: 2000, duracaoS: 20 }),
  ])
  expect(ias.length).toBe(1)
  expect(ias[0]?.chamadas).toBe(2)
  expect(ias[0]?.custoUsd).toBe(0.3)
  expect(ias[0]?.tokens).toBe(3000)
  expect(ias[0]?.duracaoS).toBe(30)
})

test('custo nao medido em uma chamada contamina a linha agregada', async () => {
  const { agregarPorIa } = await import('../lib/runner/ias-da-sessao')
  const ias = agregarPorIa([chamada({ custoMedido: true }), chamada({ custoMedido: false })])
  expect(ias[0]?.custoMedido).toBe(false)
})

test('troca de provedor DENTRO do mesmo papel e evento; por papel diferente nao e', async () => {
  const { trocasDeProvedor } = await import('../lib/runner/ias-da-sessao')
  const semTroca = trocasDeProvedor([
    chamada({ papel: 'implement', provedor: 'claude' }),
    chamada({ papel: 'gate', provedor: 'codex' }),
  ])
  expect(semTroca).toEqual([])

  const comTroca = trocasDeProvedor([
    chamada({ papel: 'implement', provedor: 'claude' }),
    chamada({ papel: 'implement', provedor: 'codex' }),
  ])
  expect(comTroca.length).toBe(1)
  expect(comTroca[0]).toEqual({ papel: 'implement', rotulo: 'executa', de: 'claude', para: 'codex' })
})

test('o resumo da sessao fecha custo e tokens com o ledger', async () => {
  const m = await import('../lib/runner/ias-da-sessao')
  const sessao = m.abrirSessao('010')
  m.registrarChamada(sessao, chamada({ papel: 'implement', custoUsd: 0.5, tokens: 5000 }))
  m.registrarChamada(sessao, chamada({ papel: 'gate', provedor: 'codex', custoUsd: 0.05, tokens: 500 }))
  const r = m.resumoDaSessao(sessao)
  expect(r.chamadas).toBe(2)
  expect(r.custoUsd).toBe(0.55)
  expect(r.tokens).toBe(5500)
  expect(r.curto).toBe(m.idCurto(sessao))
})

test('REINICIO DO DAEMON: o finish retoma o ledger em disco em vez de partir a sessao', async () => {
  const m = await import('../lib/runner/ias-da-sessao')
  const sessao = m.abrirSessao('010', Date.parse('2026-08-19T12:00:00Z'))
  m.registrarChamada(sessao, chamada({ papel: 'implement' }))
  m.esquecerSessoes()
  expect(m.sessaoDoCard('010')).toBe(sessao)
  m.registrarChamada(m.sessaoDoCard('010'), chamada({ papel: 'gate', provedor: 'codex' }))
  expect(m.resumoDaSessao(sessao).chamadas).toBe(2)
})

test('sessao de conversa e separada da sessao de card', async () => {
  const { sessaoParaChamada } = await import('../lib/runner/cost-trust')
  const daConversa = sessaoParaChamada('')
  const doCard = sessaoParaChamada('010')
  expect(daConversa.startsWith('conversa-')).toBe(true)
  expect(doCard.startsWith('010-')).toBe(true)
  expect(sessaoParaChamada('')).toBe(daConversa)
})

test('o registro da run embute a sessao e as IAs que participaram', async () => {
  const m = await import('../lib/runner/ias-da-sessao')
  const { writeRun } = await import('../lib/runner/runs')
  const sessao = m.abrirSessao('010')
  m.registrarChamada(sessao, chamada({ papel: 'implement', custoUsd: 0.4 }))
  m.registrarChamada(sessao, chamada({ papel: 'gate', provedor: 'codex', custoUsd: 0.02 }))
  const rec = writeRun('010', {
    ok: true, cost: '0.42', costMeasured: true, provider: 'claude', model: 'opus-5',
    usage: { tokens_in: 10, tokens_out: 20, tokens_cache_create: 0, tokens_cache_read: 0 },
  }, 42, null)
  expect(rec.session).toBe(sessao)
  expect(rec.ias?.length).toBe(2)
  expect(rec.ias?.map(i => i.rotulo)).toEqual(['executa', 'revisa'])
  expect(rec.trocas).toEqual([])
})

test('o finish refresca as IAs da run, sem perder o que ja estava', async () => {
  const m = await import('../lib/runner/ias-da-sessao')
  const { writeRun, updateRunSteps } = await import('../lib/runner/runs')
  const sessao = m.abrirSessao('010')
  m.registrarChamada(sessao, chamada({ papel: 'implement' }))
  const rec = writeRun('010', {
    ok: true, cost: '0.1', costMeasured: true, provider: 'claude', model: 'opus-5',
    usage: { tokens_in: 10, tokens_out: 20, tokens_cache_create: 0, tokens_cache_read: 0 },
  }, 10, null)
  expect(rec.ias?.length).toBe(1)
  m.registrarChamada(sessao, chamada({ papel: 'step', provedor: 'codex' }))
  updateRunSteps('010', { Testes: { time: 5, cost: 0.01, tokens: 100 } })
  const { readRunSteps } = await import('../lib/runner/runs')
  expect(readRunSteps('010')?.Testes?.tokens).toBe(100)
  const arquivo = join(estado, 'runs', `010-${rec.ts.replace(/[^0-9]/g, '').slice(0, 14)}.json`)
  const lido = JSON.parse(readFileSync(arquivo, 'utf8')) as { ias?: { rotulo: string }[] }
  expect(lido.ias?.map(i => i.rotulo)).toEqual(['executa', 'poli'])
})
