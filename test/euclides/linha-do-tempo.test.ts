import { test, expect } from '../apoio/runner.ts'
import { blocosDeChamada, casarComLedger, chamadasEmVoo, harnessAtual, linhaDoTempo, marcoDoEvento, papelDoRotulo, trocasNaLinha } from '../../motor/euclides/linha-do-tempo.ts'
import type { Marco } from '../../motor/euclides/linha-do-tempo.ts'
import { parseLog } from '../../motor/mirante/atividade.ts'
import type { EventoDoCard } from '../../motor/euclides/eventos.ts'
import type { ChamadaDeIa } from '../../motor/cordel/tipos.ts'

const LOG = [
  '— chamada em 2026-09-12T10:00:00Z · implement · vitro —',
  '— sessao iniciada (claude-fable-5-1) —',
  'Vou mexer no menu.',
  '  → Edit({"file_path":"src/menu.vue"})',
  '  ← ok',
  '— concluido (custo $0.4000) —',
  '[lente 1/2] — chamada em 2026-09-12T10:05:00Z · ideacao · lente 1/2 —',
  '[lente 2/2] — chamada em 2026-09-12T10:05:00Z · ideacao · lente 2/2 —',
  '[lente 1/2] ideia A',
  '[lente 2/2] ideia B',
  '[lente 1/2] — concluido (custo $0.0500) —',
  '— chamada em 2026-09-12T10:10:00Z · gate · crivo —',
  '  → Read({"file_path":"src/menu.vue"})',
].join('\n')

function chamada(ts: string, papel: ChamadaDeIa['papel'], provedor: string, custoUsd: number, modelo = 'm'): ChamadaDeIa {
  return { ts, papel, provedor, modelo, custoUsd, custoMedido: true, tokens: 10, tokensEntrada: 5, tokensSaida: 5, tokensCache: 0, duracaoS: 30, ok: true }
}

const LEDGER: ChamadaDeIa[] = [
  chamada('2026-09-12T10:04:00Z', 'implement', 'claude', 0.4, 'claude-fable-5-1'),
  chamada('2026-09-12T10:06:00Z', 'ideacao', 'claude', 0.05),
]

const EVENTOS: EventoDoCard[] = [
  { ts: '2026-09-12T09:59:00Z', card: '001', evento: 'fase_inicio', fase: 'implement', detalhe: 'vitro' },
  { ts: '2026-09-12T10:04:30Z', card: '001', evento: 'fase_fim', fase: 'implement', detalhe: 'aprovada' },
  { ts: '2026-09-12T10:09:00Z', card: '001', evento: 'gate_start', fase: 'Testes', detalhe: 'crivo' },
  { ts: '2026-09-12T10:12:00Z', card: '001', evento: 'gate_verdict', fase: 'Testes', detalhe: 'CONDITIONAL', resultado: 'falta teste do menu' },
  { ts: '2026-09-12T10:12:30Z', card: '001', evento: 'repair_attempt', fase: 'Testes', detalhe: 'tentativa 1/2: falta teste do menu' },
  { ts: '2026-09-12T10:13:00Z', card: '001', evento: 'human_checkpoint', chave: 'URL', resultado: 'aberto', detalhe: 'veio de EXECUTING' },
]

test('o rotulo comeca pelo papel; rotulo antigo (so o agente) cai em desconhecido em vez de inventar papel', () => {
  expect(papelDoRotulo('implement · vitro')).toBe('implement')
  expect(papelDoRotulo('gate · crivo · gauntlet 3 candidatos cegos')).toBe('gate')
  expect(papelDoRotulo('rufus')).toBe('desconhecido')
  expect(papelDoRotulo('')).toBe('desconhecido')
})

test('as atividades viram blocos de chamada: um por cabecalho, raias concorrentes separadas, e a chamada sem fim fica em voo', () => {
  const blocos = blocosDeChamada(parseLog(LOG))
  expect(blocos.map(b => [b.rotulo, b.raia, b.concluida, b.atividades.length])).toEqual([
    ['implement · vitro', '', true, 2],
    ['ideacao · lente 1/2', 'lente 1/2', true, 1],
    ['ideacao · lente 2/2', 'lente 2/2', false, 1],
    ['gate · crivo', '', false, 1],
  ])
  expect(blocos[0]?.modelo, 'o modelo vem da linha de sessao do claude').toBe('claude-fable-5-1')
  expect(blocos[0]?.custoAnunciado).toBe('US$0.4000')
  expect(chamadasEmVoo(blocos).map(b => b.rotulo)).toEqual(['ideacao · lente 2/2', 'gate · crivo'])
})

test('o ledger casa com o bloco do mesmo papel que terminou depois do inicio da chamada, e cada entrada e usada uma vez so', () => {
  const casados = casarComLedger(blocosDeChamada(parseLog(LOG)), LEDGER)
  expect(casados[0]?.ledger?.custoUsd).toBe(0.4)
  expect(casados[1]?.ledger?.custoUsd).toBe(0.05)
  expect(casados[2]?.ledger, 'lente 2 nao concluiu: nao rouba a entrada do ledger da lente 1').toBeUndefined()
  expect(casados[3]?.ledger, 'gate em voo nao tem entrada ainda').toBeUndefined()
})

test('troca de provedor no mesmo papel vira marco com de/para; papel diferente nao e troca', () => {
  const trocas = trocasNaLinha([
    chamada('2026-09-12T10:00:00Z', 'implement', 'claude', 1),
    chamada('2026-09-12T10:01:00Z', 'gate', 'kimi', 1),
    chamada('2026-09-12T10:02:00Z', 'implement', 'kimi', 1),
  ])
  expect(trocas).toEqual([{ tipo: 'troca', ts: '2026-09-12T10:02:00Z', papel: 'implement', de: 'claude', para: 'kimi' }])
  expect(harnessAtual([chamada('2026-09-12T10:00:00Z', 'implement', 'claude', 1), chamada('2026-09-12T10:02:00Z', 'implement', 'kimi', 1, 'k2')])).toEqual({ provedor: 'kimi', modelo: 'k2', trocas: 1 })
})

test('cada tipo de evento vira o marco certo; gate_verdict separa veredito de motivo', () => {
  const m = EVENTOS.map(marcoDoEvento)
  expect(m[0]).toMatchObject({ tipo: 'fase', fase: 'implement', inicio: true, detalhe: 'vitro' })
  expect(m[2]).toMatchObject({ tipo: 'gate', inicio: true })
  expect(m[3]).toMatchObject({ tipo: 'gate', inicio: false, veredito: 'CONDITIONAL', motivo: 'falta teste do menu' })
  expect(marcoDoEvento({ ts: 't', card: '1', evento: 'gate_verdict', fase: 'x', detalhe: 'NAO EXECUTOU: timeout' })).toMatchObject({ veredito: 'NAO', motivo: 'EXECUTOU: timeout' })
  expect(m[4]).toMatchObject({ tipo: 'reparo', fase: 'Testes' })
  expect(m[5]).toMatchObject({ tipo: 'checkpoint', estado: 'URL', aberto: true })
  expect(marcoDoEvento({ ts: 't', card: '1', evento: 'orfao', chave: 'worktree', detalhe: 'x' })).toEqual({ tipo: 'evento', ts: 't', evento: 'orfao', detalhe: 'worktree: x' })
})

test('PONTA A PONTA: a linha do tempo intercala decisao do motor e chamada de IA na ordem em que aconteceram', () => {
  const marcos = linhaDoTempo({ eventos: EVENTOS, chamadas: LEDGER, atividades: parseLog(LOG) })
  const resumo = marcos.map((m: Marco) => (m.tipo === 'chamada' ? `chamada:${m.rotulo}` : m.tipo === 'fase' ? `fase:${m.inicio ? 'abre' : 'fecha'}` : m.tipo === 'gate' ? `gate:${m.inicio ? 'abre' : m.veredito}` : m.tipo))
  expect(resumo).toEqual([
    'fase:abre',
    'chamada:implement · vitro',
    'fase:fecha',
    'chamada:ideacao · lente 1/2',
    'chamada:ideacao · lente 2/2',
    'gate:abre',
    'chamada:gate · crivo',
    'gate:CONDITIONAL',
    'reparo',
    'checkpoint',
  ])
})
