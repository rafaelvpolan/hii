// A decisao do pipeline manual como funcao pura (raio-x, onda 3): a invariante
// "um passo nunca e pago duas vezes" morava espalhada em tres trechos de
// fechar.ts e nao tinha onde ser testada sozinha. Dois defeitos ficam travados
// aqui: pipeline_feitos por LABEL fazia renomear um label em config/pipeline.json
// re-pagar passo em silencio (agora ids, com label legado aceito); e
// pipeline_liberado grudado de um HALT descartava o pedido de passo unico
// seguinte — o pedido MAIS RECENTE do humano agora vence.
import { test, expect } from '../apoio/runner.ts'
import type { PipelineStep } from '../../motor/niemeyer/tipos.ts'

const { quaisPassosRodar, feitosDoCard } = await import('../../motor/quilombo/cartorio/plano-de-passos.ts')

function passo(id: string, label: string, needs: string[] = []): PipelineStep {
  return { id, label, kind: 'quality', agent: 'x', state: 'REFINED', gate: 'none', enabled: true, needs, instruction: 'i' }
}

const ALL = [passo('arquitetura', 'Arquitetura'), passo('testes', 'Testes', ['arquitetura']), passo('seguranca', 'Seguranca', ['arquitetura']), passo('limpeza', 'Limpeza', ['testes', 'seguranca'])]

function entrada(extra: Partial<Parameters<typeof quaisPassosRodar>[0]>): Parameters<typeof quaisPassosRodar>[0] {
  return { manual: true, passoUnico: '', liberado: false, feitosCru: '', aposRetomada: ALL, all: ALL, profile: 'padrao', ...extra }
}

test('modo automatico passa tudo adiante sem filtrar nem pausar', () => {
  const r = quaisPassosRodar(entrada({ manual: false, feitosCru: 'arquitetura' }))
  expect(r.tipo).toBe('rodar')
  if (r.tipo === 'rodar') expect(r.vaoRodar.length).toBe(4)
})

test('feitos por ID e por LABEL legado pulam o passo — renomear label nao re-paga', () => {
  const r = quaisPassosRodar(entrada({ liberado: true, feitosCru: 'arquitetura,Testes' }))
  expect(r.tipo).toBe('rodar')
  if (r.tipo === 'rodar') expect(r.vaoRodar.map(s => s.id)).toEqual(['seguranca', 'limpeza'])
})

test('sem pedido e com passos restantes, a decisao e PAUSAR aguardando o humano', () => {
  const r = quaisPassosRodar(entrada({}))
  expect(r.tipo).toBe('pausar')
  if (r.tipo === 'pausar') {
    expect(r.motivo).toBe('')
    expect(r.restantes.length).toBe(4)
  }
})

test('sem pedido e SEM passo restante, segue ao fecho — a suite nao fica presa em pausa vazia', () => {
  const r = quaisPassosRodar(entrada({ feitosCru: 'arquitetura,testes,seguranca,limpeza' }))
  expect(r.tipo).toBe('rodar')
  if (r.tipo === 'rodar') expect(r.vaoRodar).toEqual([])
})

test('passo unico valido roda SO ele', () => {
  const r = quaisPassosRodar(entrada({ passoUnico: 'seguranca', feitosCru: 'arquitetura' }))
  expect(r.tipo).toBe('rodar')
  if (r.tipo === 'rodar') {
    expect(r.vaoRodar.map(s => s.id)).toEqual(['seguranca'])
    expect(r.passoUnicoAtivo).toBe('seguranca')
    expect(r.liberacaoCaducada).toBe(false)
  }
})

test('passo unico VENCE a liberacao grudada — o pedido mais recente do humano manda', () => {
  const r = quaisPassosRodar(entrada({ passoUnico: 'seguranca', liberado: true, feitosCru: 'arquitetura' }))
  expect(r.tipo).toBe('rodar')
  if (r.tipo === 'rodar') {
    expect(r.vaoRodar.map(s => s.id)).toEqual(['seguranca'])
    expect(r.liberacaoCaducada, 'fechar.ts limpa pipeline_liberado quando isto e true').toBe(true)
  }
})

test('passo unico fora do plano pausa com o motivo, sem rodar nada', () => {
  const r = quaisPassosRodar(entrada({ passoUnico: 'limpeza', feitosCru: 'arquitetura,testes,seguranca,limpeza' }))
  expect(r.tipo).toBe('pausar')
  if (r.tipo === 'pausar') expect(r.motivo).toContain('nao esta no plano')
})

test('passo unico com dependencia por pagar pausa e NOMEIA o que falta', () => {
  const r = quaisPassosRodar(entrada({ passoUnico: 'limpeza', feitosCru: 'arquitetura,Testes' }))
  expect(r.tipo).toBe('pausar')
  if (r.tipo === 'pausar') {
    expect(r.motivo).toContain('depende de')
    expect(r.motivo).toContain('Seguranca')
    expect(r.motivo).not.toContain('Testes')
  }
})

test('feitosDoCard tolera vazio, espacos e virgulas soltas', () => {
  expect(feitosDoCard(undefined)).toEqual([])
  expect(feitosDoCard(' arquitetura , ,Testes,')).toEqual(['arquitetura', 'Testes'])
})
