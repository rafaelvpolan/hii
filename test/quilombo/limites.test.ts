import { test, expect } from '../apoio/runner.ts'

const L = await import('../../motor/quilombo/limites.ts')

test('quantos worktrees cabem sai da divisao do orcamento, nao de um numero chutado', () => {
  const c = L.quantosWorktreesCabem({ totalMemoriaMb: 8192, memoriaPorWorktreeMb: 2048, totalCpus: 4, cpuPorWorktree: 1 })
  expect(c.cabem).toBe(4)
  expect(c.limitante).toBe('memoria e cpu')
})

test('o recurso mais escasso e que limita, e o relato diz qual', () => {
  const c = L.quantosWorktreesCabem({ totalMemoriaMb: 2048, memoriaPorWorktreeMb: 2048, totalCpus: 8, cpuPorWorktree: 1 })
  expect(c.cabem).toBe(1)
  expect(c.limitante).toBe('memoria')
})

test('nunca devolve zero — um card por vez sempre cabe, senao o motor nao roda', () => {
  const c = L.quantosWorktreesCabem({ totalMemoriaMb: 256, memoriaPorWorktreeMb: 2048, totalCpus: 1, cpuPorWorktree: 4 })
  expect(c.cabem, 'devolver zero pararia a fila para sempre sem dizer por que').toBe(1)
  expect(c.motivo).toContain('menor que o orcamento')
})

test('orcamento invalido LANCA — divisao por zero viraria paralelismo infinito', () => {
  expect(() => L.quantosWorktreesCabem({ totalMemoriaMb: 8192, memoriaPorWorktreeMb: 0, totalCpus: 4, cpuPorWorktree: 1 })).toThrow('memoriaPorWorktreeMb')
  expect(() => L.quantosWorktreesCabem({ totalMemoriaMb: 8192, memoriaPorWorktreeMb: 2048, totalCpus: 4, cpuPorWorktree: 0 })).toThrow('cpuPorWorktree')
})

// `podeAbrirMaisUm` saiu: nao tinha consumidor de producao E ignorava
// HICODE_CONCURRENCY, ou seja era uma SEGUNDA regra de paralelismo mais fraca que
// a do escalonador. Quem decide e `tetoDeParalelismo`, aplicado em fila.ts.
test('tetoDeParalelismo respeita o MENOR entre o configurado e o que cabe', () => {
  const orc = { totalMemoriaMb: 4096, memoriaPorWorktreeMb: 2048, totalCpus: 4, cpuPorWorktree: 1 }
  expect(L.quantosWorktreesCabem(orc).cabem, 'o recurso comporta 2').toBe(2)
  expect(L.tetoDeParalelismo(5, orc), 'o recurso limita').toBe(2)
  expect(L.tetoDeParalelismo(1, orc), 'o operador pode BAIXAR').toBe(1)
  expect(L.tetoDeParalelismo(0, orc), 'nunca zero: um card por vez sempre cabe').toBe(1)
  expect(L.tetoDeParalelismo(2, orc)).toBe(2)
})

test('o modulo nao expoe uma segunda regra de paralelismo', () => {
  expect('podeAbrirMaisUm' in L, 'duas fontes de verdade, e a morta permitia mais que a viva').toBe(false)
})

test('o orcamento vem de env, com padrao declarado — 12-factor, nada amarrado em codigo', () => {
  const anterior = process.env.HICODE_MEM_POR_WORKTREE_MB
  process.env.HICODE_MEM_POR_WORKTREE_MB = '512'
  try {
    expect(L.orcamentoDeRecurso().memoriaPorWorktreeMb).toBe(512)
  } finally {
    if (anterior === undefined) delete process.env.HICODE_MEM_POR_WORKTREE_MB
    else process.env.HICODE_MEM_POR_WORKTREE_MB = anterior
  }
})

test('o limite REAL de cpu/memoria e do container, nao do processo — o motor limita concorrencia', () => {
  expect(L.relatoDeLimites(L.orcamentoDeRecurso())).toContain('docker-stack')
})

// Item 32 — a ligacao que faltava. Ate a Onda B, quantosWorktreesCabem era
// calculado e NUNCA lido: o escalonador (motor/oswaldo/mutirao/fila.ts) usava so
// HICODE_CONCURRENCY, entao o teto de cpu/memoria do docker-stack.yml era
// decorativo e o comentario do stack afirmava, com file:line, que o motor lia
// esses valores. Nao lia.
test('LIGACAO o teto de recurso limita a concorrencia: vence o MENOR dos dois', () => {
  const apertado = { totalMemoriaMb: 4096, memoriaPorWorktreeMb: 2048, totalCpus: 2, cpuPorWorktree: 1 }
  expect(L.tetoDeParalelismo(3, apertado), 'os valores do docker-stack.yml comportam 2, nao os 3 do padrao').toBe(2)
})

test('LIGACAO o operador ainda pode BAIXAR pelo HICODE_CONCURRENCY', () => {
  const folgado = { totalMemoriaMb: 65536, memoriaPorWorktreeMb: 2048, totalCpus: 32, cpuPorWorktree: 1 }
  expect(L.tetoDeParalelismo(2, folgado), 'quem configura menos manda; o teto so impede subir').toBe(2)
})

test('LIGACAO container minusculo nao para a fila — um card por vez sempre cabe', () => {
  const minusculo = { totalMemoriaMb: 256, memoriaPorWorktreeMb: 2048, totalCpus: 1, cpuPorWorktree: 4 }
  expect(L.tetoDeParalelismo(3, minusculo), 'devolver zero pararia a fila para sempre sem dizer por que').toBe(1)
})

// O doctor existe para ser rodado QUANDO algo esta errado: ele nao pode morrer por
// causa do que veio checar. `quantosWorktreesCabem` lanca em orcamento invalido.
test('checkRecurso reporta orcamento invalido em vez de derrubar o doctor', async () => {
  const { checkRecurso } = await import('../../motor/euclides/radar/doctor.ts')
  const anterior = process.env.HICODE_CPU_POR_WORKTREE
  process.env.HICODE_CPU_POR_WORKTREE = '0'
  try {
    const c = checkRecurso()
    expect(c.severidade).toBe('erro')
    expect(c.detalhe).toContain('invalido')
  } finally {
    if (anterior === undefined) delete process.env.HICODE_CPU_POR_WORKTREE
    else process.env.HICODE_CPU_POR_WORKTREE = anterior
  }
})

test('checkRecurso avisa quando o RECURSO limita, nao a configuracao', async () => {
  const { checkRecurso } = await import('../../motor/euclides/radar/doctor.ts')
  const antes = { mem: process.env.HICODE_MEM_TOTAL_MB, por: process.env.HICODE_MEM_POR_WORKTREE_MB }
  process.env.HICODE_MEM_TOTAL_MB = '2048'
  process.env.HICODE_MEM_POR_WORKTREE_MB = '2048'
  try {
    const c = checkRecurso()
    expect(['ok', 'aviso']).toContain(c.severidade)
    expect(c.detalhe).toContain('worktree')
  } finally {
    if (antes.mem === undefined) delete process.env.HICODE_MEM_TOTAL_MB
    else process.env.HICODE_MEM_TOTAL_MB = antes.mem
    if (antes.por === undefined) delete process.env.HICODE_MEM_POR_WORKTREE_MB
    else process.env.HICODE_MEM_POR_WORKTREE_MB = antes.por
  }
})
