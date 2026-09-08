// decidirRota e decisao pura sobre uma consulta injetada — aqui a consulta e de
// mentira de proposito: cada regra do roteador precisa ser provada nos DOIS sentidos
// (escolhe quando deve, recusa quando deve) sem depender de quem esta instalado na
// maquina, de env ou de cota real. A consulta REAL (registro + janelas) e coberta
// pelo teste de integracao do caminho de quota em executar/politica.

import { test, expect } from '../apoio/runner.ts'
import { decidirRota } from '../../motor/tomada/rota.ts'
import type { CandidatoDeRota, ConsultaDeRota, EntradaDeRota } from '../../motor/tomada/rota.ts'

function candidato(nome: string, extra: Partial<CandidatoDeRota> = {}): CandidatoDeRota {
  return { nome, agentic: true, isolaLeitura: true, rodaLocal: false, autenticado: true, cotaEsgotada: false, ...extra }
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
