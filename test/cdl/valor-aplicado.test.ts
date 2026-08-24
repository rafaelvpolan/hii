import { test, expect } from 'bun:test'

// PADRAO SISTEMICO 3 da auditoria: valor computado, documentado e nunca aplicado.
// Cada teste aqui prende UM desses valores no ponto onde ele passou a ser usado.

test('taskSyncNames alimenta a VALIDACAO: HICODE_TASK_SYNC com typo nao vira "sem sync"', async () => {
  const { taskSyncInvalido, taskSyncNames } = await import('../../motor/tmd/pnt/tarefas/registro.ts')
  const anterior = process.env.HICODE_TASK_SYNC
  try {
    delete process.env.HICODE_TASK_SYNC
    expect(taskSyncInvalido(), 'sem configurar nao ha erro nenhum').toBe('')
    process.env.HICODE_TASK_SYNC = 'github-issues'
    expect(taskSyncInvalido()).toBe('')
    process.env.HICODE_TASK_SYNC = 'github_issues'
    const erro = taskSyncInvalido()
    expect(erro, 'typo caia em null e o CLI dizia "0 espelhados" com exit 0').toContain('github_issues')
    const nomes = taskSyncNames()
    expect(nomes.length, 'lista vazia tornaria o laco abaixo vacuo').toBeGreaterThan(1)
    for (const n of nomes) expect(erro).toContain(n)
  } finally {
    if (anterior === undefined) delete process.env.HICODE_TASK_SYNC
    else process.env.HICODE_TASK_SYNC = anterior
  }
})

test('runSync reprova o sync invalido em vez de relatar sucesso vazio', async () => {
  const { runSync } = await import('../../motor/tmd/pnt/tarefas/sync.ts')
  const anterior = process.env.HICODE_TASK_SYNC
  process.env.HICODE_TASK_SYNC = 'nao-existe'
  try {
    const r = await runSync()
    expect(r.ok).toBe(false)
    expect(r.falhas.join(' ')).toContain('nao-existe')
    expect(r.pushed).toBe(0)
  } finally {
    if (anterior === undefined) delete process.env.HICODE_TASK_SYNC
    else process.env.HICODE_TASK_SYNC = anterior
  }
})

test('FonteDeSkills.ativa APLICA: origem desligada sai da ordem de resolucao', async () => {
  const { ordemAtiva } = await import('../../motor/csd/resolver.ts')
  const fontes = [{ id: 'ecc', ativa: false }, { id: 'outra', ativa: true }]
  expect(ordemAtiva(['_native', 'ecc', 'outra'], fontes), 'desligar no arquivo nao desligava nada')
    .toEqual(['_native', 'outra'])
  expect(ordemAtiva(['_native', 'ecc'], []), 'origem sem declaracao de `ativa` continua ligada')
    .toEqual(['_native', 'ecc'])
  // `_native` e exempto: e ele que desempata colisao de id entre origens externas,
  // e sem ele gerarResolved passa a LANCAR em qualquer colisao. `ecc` fica porque
  // origem sem declaracao continua ligada.
  expect(ordemAtiva(['_native', 'ecc'], [{ id: '_native', ativa: false }])).toEqual(['_native', 'ecc'])
  expect(ordemAtiva(['_native', 'ecc'], [{ id: '_native', ativa: false }, { id: 'ecc', ativa: false }]))
    .toEqual(['_native'])
})

test('o rodape mostra o modo EFETIVO, nao vazio quando o operador nao escolheu', async () => {
  const { modoResolvido, modoPadraoDoProvedor } = await import('../../motor/tmd/modos.ts')
  expect(modoResolvido('claude', undefined), 'campo vazio esconde em que modo a ia vai rodar')
    .toBe(modoPadraoDoProvedor('claude'))
  // COMPORTAMENTO, e nao grep: chamar modoResolvido e descartar o retorno passaria
  // pelo texto-fonte. O que importa e a linha de propriedades TER o modo.
  const { rodapeDa } = await import('../../motor/mir/cli/rodape-tui.ts')
  const { newSession } = await import('../../motor/mir/sessao.ts')
  const linhas = rodapeDa(newSession(''))
  expect(linhas[0], 'sem modo na linha, o humano nao ve se a ia vai pedir aprovacao')
    .toContain(`modo ${modoPadraoDoProvedor('claude')}`)
})

test('o teto do painel e o MESMO que o motor aplica no card', async () => {
  const { lerConfig } = await import('../../motor/cdl/ali/snapshot.ts')
  const { tetoDoCard } = await import('../../motor/euc/tsr/orcamento.ts')
  const anterior = process.env.HICODE_CARD_BUDGET_USD
  try {
    process.env.HICODE_CARD_BUDGET_USD = '7'
    expect(tetoDoCard()).toBe(7)
    expect(lerConfig('', '', 0).tetoUsd, 'o painel lia HICODE_BUDGET_USD, que nada mais escreve — mostrava 0 com o motor barrando em 16').toBe(7)
    delete process.env.HICODE_CARD_BUDGET_USD
    expect(lerConfig('', '', 0).tetoUsd, 'sem env, vale o teto de model-tier.json').toBe(tetoDoCard())
    expect(lerConfig('', '', 0).tetoUsd).toBeGreaterThan(0)
  } finally {
    if (anterior === undefined) delete process.env.HICODE_CARD_BUDGET_USD
    else process.env.HICODE_CARD_BUDGET_USD = anterior
  }
})

test('placar() saiu: era reexport de contar() sem consumidor — duas contagens, uma morta', async () => {
  const rda = await import('../../motor/cic/rda.ts')
  expect('placar' in rda).toBe(false)
  const { contar } = await import('../../motor/cic/vto.ts')
  expect(contar([{ lente: 'a', escolha: 'x', porque: '' }]).get('x')).toBe(1)
})
