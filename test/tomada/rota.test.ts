// decidirRota e decisao pura sobre uma consulta injetada — aqui a consulta e de
// mentira de proposito: cada regra do roteador precisa ser provada nos DOIS sentidos
// (escolhe quando deve, recusa quando deve) sem depender de quem esta instalado na
// maquina, de env ou de cota real. A consulta REAL (registro + janelas) e coberta
// pelo teste de integracao do caminho de quota em executar/politica.

import { test, expect } from '../apoio/runner.ts'
import { decidirRota } from '../../motor/tomada/rota.ts'
import type { CandidatoDeRota, ConsultaDeRota, EntradaDeRota } from '../../motor/tomada/rota.ts'

function candidato(nome: string, extra: Partial<CandidatoDeRota> = {}): CandidatoDeRota {
  return { nome, agentic: true, isolaLeitura: true, rodaLocal: false, autenticado: true, cotaEsgotada: false, emitsStructuredJson: true, ...extra }
}

function consultaDe(candidatos: CandidatoDeRota[]): ConsultaDeRota {
  return {
    candidatosDoPapel: () => candidatos.map(c => c.nome),
    candidato: (nome: string) => candidatos.find(c => c.nome === nome),
  }
}

function quota(sobra: Partial<EntradaDeRota> = {}): EntradaDeRota {
  return { papel: 'implement', classeDeFalha: 'quota', provedorAtual: 'claude', tentadosNestaRodada: [], ...sobra }
}

test('falha terminal NUNCA troca — repetir em outro provedor da o mesmo resultado', () => {
  const r = decidirRota(quota({ classeDeFalha: 'terminal' }), consultaDe([candidato('codex')]))
  expect(r.acao).toBe('manter_politica_atual')
  expect(r.motivo).toContain('terminal')
})

test('quota troca para o primeiro candidato apto que nao e o provedor atual', () => {
  const r = decidirRota(quota(), consultaDe([candidato('claude'), candidato('codex')]))
  expect(r.acao).toBe('trocar')
  expect(r.acao === 'trocar' && r.para).toBe('codex')
})

test('roteador inteligente preserva a ordem configurada quando os scores empatam', () => {
  const r = decidirRota(quota(), consultaDe([candidato('claude'), candidato('codex'), candidato('kimi')]))
  expect(r.acao === 'trocar' && r.para).toBe('codex')
})

test('roteador inteligente escolhe candidato com score melhor mesmo quando nao e o primeiro', () => {
  const r = decidirRota(quota(), consultaDe([
    candidato('claude'),
    candidato('codex'),
    candidato('kimi', { supportsAgents: true, reportsCostUsd: true, reportsTokens: true, preservaContexto: true }),
  ]))
  expect(r.acao === 'trocar' && r.para).toBe('kimi')
  expect(r.motivo).toContain('score')
  expect(r.motivo).toContain('preserva contexto')
})

test('quem ja falhou NESTA rodada nao e tentado de novo — era isto que fazia "primeiro retry: fallback; segundo: parede"', () => {
  const r = decidirRota(quota({ provedorAtual: 'codex', tentadosNestaRodada: ['claude'] }),
    consultaDe([candidato('claude'), candidato('codex'), candidato('kimi')]))
  expect(r.acao).toBe('trocar')
  expect(r.acao === 'trocar' && r.para).toBe('kimi')
})

test('implement exige agentic: provedor que nao edita arquivo nao entra na rota', () => {
  const r = decidirRota(quota(), consultaDe([candidato('claude'), candidato('ollama', { agentic: false }), candidato('codex')]))
  expect(r.acao === 'trocar' && r.para).toBe('codex')
})

test('verify exige isolamento de leitura — a mesma regra que confianca.ts ja aplica para recusar', () => {
  const r = decidirRota(quota({ papel: 'verify' }), consultaDe([candidato('claude'), candidato('codex', { isolaLeitura: false }), candidato('kimi')]))
  expect(r.acao === 'trocar' && r.para).toBe('kimi')
})

test('nao autenticado e cota esgotada ficam de fora — trocar para quem tambem vai falhar so paga outra volta', () => {
  const r = decidirRota(quota(), consultaDe([
    candidato('claude'),
    candidato('codex', { autenticado: false }),
    candidato('kimi', { cotaEsgotada: true }),
  ]))
  expect(r.acao).toBe('manter_politica_atual')
  expect(r.motivo).toContain('nenhum candidato apto')
})

test('papel mecanico prefere quem roda local — step e verify de graca em dolar quando da', () => {
  const r = decidirRota(quota({ papel: 'step' }), consultaDe([candidato('claude'), candidato('codex'), candidato('ollama', { rodaLocal: true })]))
  expect(r.acao === 'trocar' && r.para).toBe('ollama')
})

test('implement NAO prefere local: a ordem dos candidatos vale — local so ganha em papel mecanico', () => {
  const r = decidirRota(quota(), consultaDe([candidato('claude'), candidato('codex'), candidato('ollama', { rodaLocal: true })]))
  expect(r.acao === 'trocar' && r.para).toBe('codex')
})

test('lista vazia mantem a politica atual e o motivo nomeia quem ficou de fora', () => {
  const r = decidirRota(quota({ tentadosNestaRodada: ['codex'] }), consultaDe([candidato('claude'), candidato('codex')]))
  expect(r.acao).toBe('manter_politica_atual')
  expect(r.motivo).toContain('claude')
  expect(r.motivo).toContain('codex')
})

test('candidato que a consulta nao conhece e pulado sem lancar — nome invalido em preferencia nao pode derrubar a rota', () => {
  const consulta: ConsultaDeRota = {
    candidatosDoPapel: () => ['fantasma', 'codex'],
    candidato: (nome: string) => (nome === 'codex' ? candidato('codex') : undefined),
  }
  const r = decidirRota(quota(), consulta)
  expect(r.acao === 'trocar' && r.para).toBe('codex')
})

test('gate e verify recusam candidato sem JSON mesmo com prioridade maior', () => {
  for (const papel of ['gate', 'verify'] as const) {
    const r = decidirRota(quota({ papel }), consultaDe([
      candidato('sem-json', { emitsStructuredJson: false, prioridade: 9999 }),
      candidato('apto'),
    ]))
    expect(r.acao === 'trocar' && r.para).toBe('apto')
    expect(decidirRota(quota({ papel }), consultaDe([candidato('ausente', { emitsStructuredJson: undefined })])).acao).toBe('manter_politica_atual')
  }
})
test('JSON exigido pelo pedido tambem filtra papeis mecanicos', () => {
  const r = decidirRota(quota({ papel: 'step', exigeJson: true }), consultaDe([
    candidato('local', { rodaLocal: true, emitsStructuredJson: false }),
    candidato('json'),
  ]))
  expect(r.acao === 'trocar' && r.para).toBe('json')
})

test('falha local prefere plug remoto, mas somente_local proibe a saida', () => {
  const candidatos = [candidato('ollama', { rodaLocal: true }), candidato('local-2', { rodaLocal: true, prioridade: 999 }), candidato('codex')]
  const remoto = decidirRota(quota({ provedorAtual: 'ollama', classeDeFalha: 'transient', localFalhou: true }), consultaDe(candidatos))
  expect(remoto.acao === 'trocar' && remoto.para).toBe('codex')

  process.env.HII_EXECUTION_LOCALITY = 'somente_local'
  try {
    const local = decidirRota(quota({ provedorAtual: 'ollama', classeDeFalha: 'transient', localFalhou: true }), consultaDe(candidatos))
    expect(local.acao === 'trocar' && local.para).toBe('local-2')
  } finally { delete process.env.HII_EXECUTION_LOCALITY }
})

test('somente_local recusa Ollama sem prova mesmo quando o endpoint e loopback', () => {
  process.env.HII_EXECUTION_LOCALITY = 'somente_local'
  try {
    const r = decidirRota(quota({ provedorAtual: 'claude' }), consultaDe([
      candidato('ollama', { rodaLocal: true, inferenciaLocalVerificada: false }),
    ]))
    expect(r.acao).toBe('manter_politica_atual')
  } finally { delete process.env.HII_EXECUTION_LOCALITY }
})
