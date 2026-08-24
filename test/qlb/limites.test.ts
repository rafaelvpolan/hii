import { test, expect } from 'bun:test'

const L = await import('../../motor/qlb/limites.ts')

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

test('podeAbrirMaisUm respeita o teto calculado', () => {
  const orc = { totalMemoriaMb: 4096, memoriaPorWorktreeMb: 2048, totalCpus: 4, cpuPorWorktree: 1 }
  expect(L.podeAbrirMaisUm(0, orc).pode).toBe(true)
  expect(L.podeAbrirMaisUm(1, orc).pode).toBe(true)
  expect(L.podeAbrirMaisUm(2, orc).pode).toBe(false)
  expect(L.podeAbrirMaisUm(2, orc).motivo).toContain('2')
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
