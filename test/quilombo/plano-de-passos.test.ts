// A decisao do pipeline manual como funcao pura (raio-x, onda 3): a invariante
// "um passo nunca e pago duas vezes" morava espalhada em tres trechos de
// fechar.ts e nao tinha onde ser testada sozinha. Dois defeitos ficam travados
// aqui: pipeline_feitos por LABEL fazia renomear um label em config/pipeline.json
// re-pagar passo em silencio (agora ids, com label legado aceito); e
// pipeline_liberado grudado de um HALT descartava o pedido de passo unico
// seguinte — o pedido MAIS RECENTE do humano agora vence.
import { test, expect } from '../apoio/runner.ts'
import type { PipelineStep } from '../../motor/niemeyer/tipos.ts'

const { quaisPassosRodar, feitosDoCard, indiceDeRetomada, passosRestantes, RESUME_POST_STEPS } = await import('../../motor/quilombo/cartorio/plano-de-passos.ts')

function passo(id: string, label: string, needs: string[] = []): PipelineStep {
  return { id, label, kind: 'quality', agent: 'x', state: 'REFINED', gate: 'none', enabled: true, needs, instruction: 'i' }
}

const ALL = [passo('arquitetura', 'Arquitetura'), passo('testes', 'Testes', ['arquitetura']), passo('seguranca', 'Seguranca', ['arquitetura']), passo('limpeza', 'Limpeza', ['testes', 'seguranca'])]
const ENXUTO = ALL.filter(s => s.id === 'limpeza')

type Entrada = Parameters<typeof quaisPassosRodar>[0]

function entrada(extra: Partial<Entrada>): Entrada {
  return { manual: true, passoUnico: '', liberado: false, feitosCru: '', resumeFrom: '', plano: { steps: ALL, profile: 'padrao' }, all: ALL, ...extra }
}

function ids(r: ReturnType<typeof quaisPassosRodar>): string[] {
  return r.tipo === 'rodar' ? r.vaoRodar.map(s => s.id) : []
}

test('modo automatico passa tudo adiante sem filtrar nem pausar', () => {
  const r = quaisPassosRodar(entrada({ manual: false, feitosCru: 'arquitetura' }))
  expect(r.tipo).toBe('rodar')
  expect(ids(r).length).toBe(4)
})

test('feitos por ID e por LABEL legado pulam o passo — renomear label nao re-paga', () => {
  const r = quaisPassosRodar(entrada({ liberado: true, feitosCru: 'arquitetura,Testes' }))
  expect(r.tipo).toBe('rodar')
  expect(ids(r)).toEqual(['seguranca', 'limpeza'])
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
  expect(ids(r)).toEqual([])
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

test('passo unico JA PAGO roda de novo a pedido explicito do humano, marcado como repetido', () => {
  const r = quaisPassosRodar(entrada({ passoUnico: 'limpeza', feitosCru: 'arquitetura,testes,seguranca,limpeza' }))
  expect(r.tipo).toBe('rodar')
  if (r.tipo === 'rodar') {
    expect(r.vaoRodar.map(s => s.id)).toEqual(['limpeza'])
    expect(r.repetido, 'fechar.ts avisa no diario que esta rodando de novo a pedido').toBe(true)
  }
  const normal = quaisPassosRodar(entrada({ passoUnico: 'limpeza', feitosCru: 'arquitetura,testes,seguranca' }))
  if (normal.tipo === 'rodar') expect(normal.repetido).toBe(false)
})

test('passo unico anterior ao ponto de retomada pausa com o motivo, sem rodar nada', () => {
  const r = quaisPassosRodar(entrada({ passoUnico: 'arquitetura', resumeFrom: 'seguranca' }))
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

test('perfil enxuto: passo unico que o perfil nao roda e recusado citando o perfil', () => {
  const r = quaisPassosRodar(entrada({ passoUnico: 'testes', plano: { steps: ENXUTO, profile: 'enxuto' } }))
  expect(r.tipo).toBe('pausar')
  if (r.tipo === 'pausar') {
    expect(r.motivo).toContain('perfil enxuto')
    expect(r.restantes.map(s => s.id)).toEqual(['limpeza'])
  }
})

test('perfil enxuto: a suite liberada roda so o que o perfil inclui', () => {
  const r = quaisPassosRodar(entrada({ liberado: true, plano: { steps: ENXUTO, profile: 'enxuto' } }))
  expect(ids(r)).toEqual(['limpeza'])
})

test('resume_from por LABEL (como haltForInspection grava) pula os passos anteriores', () => {
  const r = quaisPassosRodar(entrada({ manual: false, resumeFrom: 'Seguranca' }))
  expect(ids(r)).toEqual(['seguranca', 'limpeza'])
  expect(r.retomada).toEqual({ indice: 2, foraDoPerfil: false })
})

test('resume_from por ID tambem e aceito — o mesmo passo nao pode ter dois nomes', () => {
  expect(indiceDeRetomada(ALL, ALL, 'seguranca')).toEqual({ indice: 2, foraDoPerfil: false })
})

test('resume_from no sentinela pos-passos nao roda nenhum, em modo automatico e manual', () => {
  const auto = quaisPassosRodar(entrada({ manual: false, resumeFrom: RESUME_POST_STEPS }))
  expect(auto.tipo).toBe('rodar')
  expect(ids(auto)).toEqual([])
  const manual = quaisPassosRodar(entrada({ liberado: true, resumeFrom: RESUME_POST_STEPS }))
  expect(manual.tipo).toBe('rodar')
  expect(ids(manual)).toEqual([])
})

test('resume_from num passo que o perfil nao roda cai no aplicavel seguinte e SINALIZA para o diario', () => {
  const r = quaisPassosRodar(entrada({ manual: false, resumeFrom: 'Testes', plano: { steps: ENXUTO, profile: 'enxuto' } }))
  expect(ids(r)).toEqual(['limpeza'])
  expect(r.retomada.foraDoPerfil).toBe(true)
  const semSeguinte = indiceDeRetomada(ALL.filter(s => s.id === 'arquitetura'), ALL, 'Testes')
  expect(semSeguinte).toEqual({ indice: 1, foraDoPerfil: true })
})

test('resume_from velho com pedido de passo unico: o passo pedido antes do ponto de retomada e recusado — por isso o cartorio limpa resume_from ao pedir', () => {
  const r = quaisPassosRodar(entrada({ passoUnico: 'arquitetura', resumeFrom: RESUME_POST_STEPS }))
  expect(r.tipo).toBe('pausar')
  if (r.tipo === 'pausar') expect(r.motivo).toContain('nao esta no plano')
})

test('INVARIANTE: um passo ja pago so volta a rodar quando e o pedido explicito de passo unico (marcado repetido); nunca antes do ponto de retomada, nunca duplicado', () => {
  const feitosPossiveis = ['', 'arquitetura', 'Arquitetura,Testes', 'arquitetura,testes,seguranca', 'Limpeza', 'arquitetura,testes,seguranca,limpeza']
  const retomadas = ['', 'Testes', 'seguranca', RESUME_POST_STEPS, 'Inexistente']
  const pedidos = ['', 'arquitetura', 'testes', 'seguranca', 'limpeza']
  const planos = [{ steps: ALL, profile: 'padrao' }, { steps: ENXUTO, profile: 'enxuto' }]
  let combinacoes = 0
  for (const feitosCru of feitosPossiveis) for (const resumeFrom of retomadas) for (const passoUnico of pedidos) for (const liberado of [false, true]) for (const plano of planos) {
    const r = quaisPassosRodar(entrada({ feitosCru, resumeFrom, passoUnico, liberado, plano }))
    combinacoes += 1
    if (r.tipo !== 'rodar') continue
    const feitos = feitosDoCard(feitosCru)
    const permitidos = passosRestantes(plano.steps.slice(r.retomada.indice), feitos).map(s => s.id)
    const aposRetomada = plano.steps.slice(r.retomada.indice).map(s => s.id)
    for (const s of r.vaoRodar) {
      const pago = feitos.includes(s.id) || feitos.includes(s.label)
      const excecaoExplicita = passoUnico === s.id && r.repetido
      expect(!pago || excecaoExplicita, `${s.id} ja pago em [${feitosCru}] rodaria de novo sem pedido explicito (resume=${resumeFrom}, pedido=${passoUnico}, liberado=${liberado}, perfil=${plano.profile})`).toBe(true)
      expect(r.repetido === pago || !passoUnico, `repetido tem de refletir se o passo pedido ja estava pago`).toBe(true)
      expect(aposRetomada.includes(s.id), `${s.id} esta antes do ponto de retomada "${resumeFrom}"`).toBe(true)
      if (!excecaoExplicita) expect(permitidos.includes(s.id)).toBe(true)
    }
    expect(new Set(r.vaoRodar.map(s => s.id)).size).toBe(r.vaoRodar.length)
    if (passoUnico) expect(r.vaoRodar.map(s => s.id)).toEqual([passoUnico])
  }
  expect(combinacoes).toBe(feitosPossiveis.length * retomadas.length * pedidos.length * 2 * planos.length)
})

test('feitosDoCard tolera vazio, espacos e virgulas soltas', () => {
  expect(feitosDoCard(undefined)).toEqual([])
  expect(feitosDoCard(' arquitetura , ,Testes,')).toEqual(['arquitetura', 'Testes'])
})
