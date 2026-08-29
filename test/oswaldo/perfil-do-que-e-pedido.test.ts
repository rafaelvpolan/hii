// Reclamado em uso: "vc esta colocando esses processos em tudo que nao precisa,
// faca uma analise mais proativa de quais coisas geralmente eu peco para ia fazer".
//
// A analise foi MEDIDA, nao suposta: o classificador rodou nos 21 pedidos reais do
// historico (titulos dos cards no git log do repo-alvo). Dois caiam em "ambiguo —
// roda tudo por seguranca", e um era o card 006, "resolva o conflito .../pull/25":
// 4 agentes de polimento, ~33min de motor e US$12,96 para costurar um merge. Pior que
// o gasto, o proprio crivo flagrou o dano — "a etapa 'Arquitetura' introduz um
// componente novo (relogio) sem ligacao clara com resolver o conflito do PR": os
// passos INVENTARAM escopo num card que so precisava fechar um conflito.
//
// A causa: nao havia UMA palavra de repositorio (conflito, merge, rebase, revert,
// changelog) em nenhuma lista de vocabulario, e `ambiguous` — que e o "nao sei" —
// defaultava para o pipeline inteiro.
//
// A outra correcao veio da mesma medicao: "Banner versao de testes" caia em `deps`
// (3 passos) porque DEPS tinha `vers\w*`, que casa "versao" em qualquer prosa.
import { test, expect } from '../apoio/runner.ts'
import { aplicarLei, planSteps } from '../../motor/oswaldo/rota/perfil.ts'
import type { TaskInput } from '../../motor/oswaldo/rota/perfil.ts'
import { DEFAULT_STEPS } from '../../motor/niemeyer/config.ts'
import { interpretarIntake, camposDoIntake } from '../../motor/mirante/comandos-manuais.ts'

function ids(task: TaskInput): string[] {
  return planSteps(task, DEFAULT_STEPS).steps.map(s => s.id)
}

test('REGRESSAO card 006: resolver conflito de PR nao roda o pipeline inteiro', () => {
  const t = 'resolva o conflito https://github.com/rafaelvpolan/hicode-site/pull/25'
  const p = planSteps({ title: t, objetivo: t, risk: 'low', surface: 'none' }, DEFAULT_STEPS)

  expect(p.profile).toBe('repo')
  expect(p.steps.map(s => s.id), 'costura de merge nao ganha nada de rufus/escudo/pura').toEqual(['testes'])
})

test('trabalho de repositorio mantem Testes — o que corre risco na costura e a suite', () => {
  for (const t of ['faca o rebase da branch em cima da main', 'reverta o commit que quebrou o build', 'atualize o changelog', 'resolve o merge da branch']) {
    expect(ids({ title: t, objetivo: t, risk: 'low' }), t).toEqual(['testes'])
  }
})

test('sinal DURO vence repositorio: conflito que toca auth ou dados roda tudo', () => {
  const login = ids({ title: 'resolva o conflito no endpoint de login', risk: 'low' })
  expect(login).toContain('seguranca')
  expect(login).toContain('testes')

  const dados = ids({ title: 'merge da branch que mexe na migration de usuarios', risk: 'low' })
  expect(dados).toContain('seguranca')
})

test('risco alto continua rodando tudo, mesmo em card de repositorio', () => {
  const p = planSteps({ title: 'resolva o conflito do PR', risk: 'high' }, DEFAULT_STEPS)
  expect(p.profile).toBe('completo')
  expect(p.steps.length).toBe(DEFAULT_STEPS.length)
})

test('REGRESSAO "versao" em prosa nao vale mais como dependencia', () => {
  const p = planSteps({ title: 'Banner versao de testes', objetivo: 'Banner versao de testes', surface: 'visual', risk: 'low' }, DEFAULT_STEPS)
  expect(p.profile).not.toBe('deps')
})

test('dependencia de verdade continua sendo dependencia', () => {
  for (const t of ['bump do pacote vite', 'atualiza dependencia do vue', 'conserta o lockfile']) {
    expect(planSteps({ title: t, objetivo: t, risk: 'low' }, DEFAULT_STEPS).profile, t).toBe('deps')
  }
})

test('os orquestradores /hii-* declaram a stack de execucao, nao so o conhecimento', () => {
  const esperado: Record<string, string> = {
    '/hii-design': 'nada',
    '/hii-dev-web': 'arquitetura,testes',
    '/hii-backend': 'testes,seguranca',
  }
  for (const [comando, steps] of Object.entries(esperado)) {
    const i = interpretarIntake(`${comando} tarefa qualquer`)
    expect(i, comando).not.toBe(null)
    expect(camposDoIntake(i!).steps, comando).toBe(steps)
  }
})

test('a stack declarada pelo orquestrador e a que roda', () => {
  const design = planSteps({ title: 'refaz o hero', surface: 'visual', risk: 'low', override: 'nada' }, DEFAULT_STEPS)
  expect(design.steps).toEqual([])

  const backend = planSteps({ title: 'cria endpoint de export', risk: 'low', override: 'testes,seguranca' }, DEFAULT_STEPS)
  expect(backend.steps.map(s => s.id)).toEqual(['testes', 'seguranca'])
})

test('a LEI ainda SOBE o rigor por cima do orquestrador — a stack e piso, nao teto', () => {
  const pedido = planSteps({ title: 'refaz o hero', surface: 'visual', risk: 'low', override: 'nada' }, DEFAULT_STEPS)
  expect(pedido.steps).toEqual([])

  const comLei = aplicarLei(pedido, { forca: 'completo', motivos: ['o diff mexeu em auth'], regras: [] }, DEFAULT_STEPS)

  expect(comLei.profile).toBe('completo')
  expect(comLei.steps.length, 'orquestrador nao pode desligar gate que o DIFF exige').toBe(DEFAULT_STEPS.length)
})

test('o orquestrador antigo sem stack declarada segue na escolha automatica', () => {
  const i = interpretarIntake('/orquestrador-dev-web tarefa qualquer')
  expect(camposDoIntake(i!).steps).toBe(undefined)
})
