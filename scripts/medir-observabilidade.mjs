// Limites definidos em observabilidade.md antes da medicao: p95 <100ms, <16MiB.
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
const dir = mkdtempSync(join(tmpdir(), 'hii-observabilidade-bench-'))
process.env.HII_CARDS_DIR = dir
const { iniciar, recurso, saida, snapshot, eventos, terminar } = await import('../motor/observabilidade/registro.ts')
try {
  const inicio = snapshot().cursor
  const id = iniciar({ repo: 'fixture/benchmark', sessao: '', execucao: '' }, recurso('fixture', 'harness'))
  const duracoes = []
  for (let i = 0; i < 2100; i++) {
    const t = performance.now()
    saida(id, 'stdout', `${i} ${'a'.repeat(128)}`)
    duracoes.push(performance.now() - t)
  }
  terminar(id, 'succeeded')
  duracoes.sort((a, b) => a - b)
  const p95 = duracoes[Math.floor(duracoes.length * .95)]
  const bytes = statSync(join(dir, 'observabilidade', 'estado.json')).size
  assert.ok(p95 < 100, `p95 ${p95}ms excede orcamento de 100ms`)
  assert.ok(bytes < 16 * 1024 * 1024)
  assert.equal(eventos(inicio).reset, true)
  assert.equal(snapshot().atividades.find(a => a.id === id)?.estado, 'succeeded')
  console.log(JSON.stringify({ transicoes: 2100, p95Ms: Number(p95.toFixed(2)), bytes, recuperacaoAposExpiracao: true }))
} finally { rmSync(dir, { recursive: true, force: true }) }
