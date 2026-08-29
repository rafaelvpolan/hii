import { test, expect } from '../apoio/runner.ts'
import { renderHistorico, linhasDasIas } from '../../motor/mirante/render/historico.ts'
import { chaveDaSessao, idDaSessao } from '../../motor/mirante/historico.ts'
import { idCurto } from '../../motor/euclides/ias-da-sessao.ts'
import { stripAnsi } from '../../motor/mirante/tui/layout.ts'
import type { HistoricoDeSessoes, Sessao } from '../../motor/mirante/historico.ts'
import type { IaDaSessao, PapelDeChamada, TrocaDeProvedor } from '../../motor/cordel/tipos.ts'

function ia(over: Partial<IaDaSessao> = {}): IaDaSessao {
  return {
    papel: 'implement' as PapelDeChamada,
    rotulo: 'executa',
    provedor: 'claude',
    modelo: 'opus-5',
    custoUsd: 0.1,
    custoMedido: true,
    tokens: 52000,
    tokensEntrada: 12000,
    tokensSaida: 20000,
    tokensCache: 20000,
    duracaoS: 120,
    chamadas: 1,
    falhas: 0,
    ...over,
  }
}

function sessao(over: Partial<Sessao> = {}): Sessao {
  return {
    arquivo: '011-20260819153200.json',
    card: '011',
    concluidoEm: '2026-08-19T15:32:00Z',
    concluidoEmMs: Date.parse('2026-08-19T15:32:00Z'),
    ok: true,
    custoUsd: 0.18,
    tokens: 52000,
    tokensEntrada: 0,
    tokensSaida: 0,
    tokensCache: 0,
    duracaoS: 205,
    provedor: 'claude',
    provedorIdentificado: true,
    modelo: 'opus-5',
    classeDeFalha: '',
    motivoDaFalha: '',
    posicao: 0,
    sessao: '011-20260819153200',
    tipo: 'execucao' as const,
    ias: [],
    trocas: [],
    ...over,
  }
}

function historico(sessoes: Sessao[]): HistoricoDeSessoes {
  return {
    sessoes,
    totalNaJanela: sessoes.length,
    custoTotalUsd: sessoes.reduce((a, s) => a + s.custoUsd, 0),
    tokensTotal: sessoes.reduce((a, s) => a + s.tokens, 0),
    falhas: sessoes.filter(s => !s.ok).length,
    janelaMs: 7 * 24 * 3600_000,
  }
}

const AGORA = Date.parse('2026-08-19T16:00:00Z')

test('a linha da sessao mostra o id curto da sessao e a tarefa como coluna', () => {
  const s = sessao()
  const linhas = renderHistorico(historico([s]), { color: false, now: AGORA }).map(stripAnsi)
  const linha = linhas.find(l => l.includes('#011')) ?? ''
  expect(linha).toContain(idCurto(idDaSessao(s)))
  expect(linha).toContain('#011')
})

test('so a sessao selecionada abre as IAs de dentro', () => {
  const s = sessao({ ias: [ia(), ia({ papel: 'gate', rotulo: 'revisa', provedor: 'codex', modelo: 'gpt-5' })] })
  const fechada = renderHistorico(historico([s]), { color: false, now: AGORA }).map(stripAnsi).join('\n')
  expect(fechada).not.toContain('executa')

  const aberta = renderHistorico(historico([s]), { color: false, now: AGORA, selecionado: chaveDaSessao(s) })
    .map(stripAnsi).join('\n')
  expect(aberta).toContain('executa')
  expect(aberta).toContain('codex/gpt-5')
})

test('as IAs saem na ordem dos papeis: executa, verifica, revisa, poli', () => {
  const s = sessao({
    ias: [
      ia({ papel: 'step', rotulo: 'poli' }),
      ia({ papel: 'gate', rotulo: 'revisa' }),
      ia({ papel: 'implement', rotulo: 'executa' }),
      ia({ papel: 'verify', rotulo: 'verifica' }),
    ],
  })
  const rotulos = linhasDasIas(s, { color: false }).map(l => stripAnsi(l).trim().split(/\s+/)[0])
  expect(rotulos).toEqual(['poli', 'revisa', 'executa', 'verifica'])
})

test('custo nao medido aparece marcado como piso, sem desalinhar a coluna', () => {
  const s = sessao({
    ias: [ia({ custoMedido: true }), ia({ papel: 'verify', rotulo: 'verifica', custoMedido: false })],
  })
  const linhas = linhasDasIas(s, { color: false }).map(stripAnsi)
  expect(linhas[1]).toContain('piso')
  const coluna = linhas.map(l => l.indexOf('US$'))
  expect(coluna[0]).toBe(coluna[1])
})

test('chamada repetida do mesmo papel e provedor aparece com o contador', () => {
  const s = sessao({ ias: [ia({ papel: 'step', rotulo: 'poli', chamadas: 3 })] })
  expect(stripAnsi(linhasDasIas(s, { color: false })[0] ?? '')).toContain('×3')
})

test('troca de ia no meio do papel aparece como evento na sessao', () => {
  const troca: TrocaDeProvedor = { papel: 'implement', rotulo: 'executa', de: 'claude', para: 'codex' }
  const s = sessao({ ias: [ia()], trocas: [troca] })
  const linhas = linhasDasIas(s, { color: false }).map(stripAnsi)
  expect(linhas[linhas.length - 1]).toContain('executa trocou de ia no meio: claude → codex')
})

test('execucao antiga, sem ledger, diz isso em vez de mentir zero', () => {
  const s = sessao({ ias: [], sessao: '' })
  const linhas = linhasDasIas(s, { color: false }).map(stripAnsi)
  expect(linhas.length).toBe(1)
  expect(linhas[0]).toContain('sem ledger de IA')
})

test('sem sessao gravada, o id curto cai no nome do arquivo e segue estavel', () => {
  const s = sessao({ sessao: '' })
  expect(idDaSessao(s)).toBe('011-20260819153200')
  expect(idCurto(idDaSessao(s))).toBe(idCurto('011-20260819153200'))
})

test('gasto de conversa nao vira US$0.00 por arredondamento', async () => {
  const { custo } = await import('../../motor/mirante/render/historico.ts')
  expect(custo(0.0042)).toBe('US$0.0042')
  expect(custo(0.12)).toBe('US$0.12')
  expect(custo(0)).toBe('—')
})

test('a linha de conversa mostra quais IAs entraram, em vez de "?"', () => {
  const s = sessao({
    tipo: 'conversa',
    card: '',
    provedor: '',
    provedorIdentificado: false,
    modelo: '',
    ias: [
      ia({ papel: 'conversa', rotulo: 'conversa', provedor: 'claude' }),
      ia({ papel: 'classificacao', rotulo: 'leitura', provedor: 'ollama' }),
    ],
  })
  const linha = renderHistorico(historico([s]), { color: false, now: AGORA }).map(stripAnsi).join('\n')
  expect(linha).toContain('chat')
  expect(linha).toContain('claude+ollama')
  expect(linha).not.toContain(' ? ')
})
