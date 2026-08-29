import { test, expect } from '../apoio/runner.ts'
import { valeDivergir } from '../../motor/oswaldo/rota/perfil.ts'

test('pergunta aberta de desenho ENTRA — ha mais de uma forma certa', () => {
  for (const objetivo of [
    'repensar a arquitetura de cache entre os nos',
    'definir a nomenclatura dos eventos do diario',
    'desenhar o contrato da api de cards',
    'escolher a estrategia de reprocessamento',
  ]) {
    const v = valeDivergir({ title: 'x', objetivo })
    expect(v.vale, `deveria divergir: "${objetivo}" (${v.motivo})`).toBe(true)
  }
})

test('resposta unica NAO ENTRA — divergir gastaria N vezes pela mesma resposta', () => {
  for (const objetivo of [
    'corrigir o calculo de comissao do vendedor',
    'ajustar a formula de juros compostos',
    'arredondar o imposto para duas casas',
    'bump da versao do lockfile',
  ]) {
    const v = valeDivergir({ title: 'x', objetivo })
    expect(v.vale, `nao deveria divergir: "${objetivo}" (${v.motivo})`).toBe(false)
  }
})

test('FECHADO vence ABERTO — "arquitetura do calculo de comissao" tem uma resposta so', () => {
  const v = valeDivergir({ title: 'arquitetura do calculo de comissao', objetivo: 'redesenhar o calculo de comissao' })
  expect(v.vale).toBe(false)
  expect(v.motivo).toContain('resposta unica')
})

test('reparo de build NAO ENTRA — o narrowFix e estreito de proposito', () => {
  const v = valeDivergir({ title: 'reparo do build quebrado', objetivo: 'consertar o build' })
  expect(v.vale).toBe(false)
})

test('mudanca cosmetica NAO ENTRA — nao ha decisao de arquitetura a tomar', () => {
  const v = valeDivergir({ title: 'corrigir typo no readme', objetivo: 'ajustar o texto do readme' })
  expect(v.vale).toBe(false)
})

test('mudanca so visual NAO ENTRA', () => {
  const v = valeDivergir({ title: 'ajustar espacamento do botao', objetivo: 'padding do botao', surface: 'visual' })
  expect(v.vale).toBe(false)
})

test('O PADRAO E NAO DIVERGIR — enunciado sem marca de desenho nao multiplica o custo', () => {
  const v = valeDivergir({ title: 'mexer numa coisa', objetivo: 'fazer o que foi pedido' })
  expect(v.vale).toBe(false)
  expect(v.motivo).toContain('padrao e nao multiplicar')
})

test('o card manda: divergir: on liga mesmo em enunciado fechado', () => {
  const v = valeDivergir({ title: 'calculo de comissao', objetivo: 'calcular comissao', divergir: 'on' })
  expect(v.vale).toBe(true)
  expect(v.motivo).toContain('ligado no card')
})

test('o card manda: divergir: off desliga mesmo em pergunta aberta', () => {
  const v = valeDivergir({ title: 'arquitetura nova', objetivo: 'repensar a arquitetura', divergir: 'off' })
  expect(v.vale).toBe(false)
  expect(v.motivo).toContain('desligado no card')
})

test('todo veredicto vem com motivo legivel — gatilho mudo nao se audita', () => {
  for (const t of [
    { title: 'arquitetura', objetivo: 'desenhar' },
    { title: 'typo', objetivo: 'texto' },
    { title: 'nada', objetivo: 'nada' },
  ]) {
    expect(valeDivergir(t).motivo.length).toBeGreaterThan(15)
  }
})
