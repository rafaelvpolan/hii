import { test, expect, afterAll } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const R = await import('../../motor/cdl/ali/runtime')
afterAll(() => { delete process.env.HICODE_RUNTIME })

test('os runtimes suportados sao declarados, nao adivinhados', () => {
  expect([...R.RUNTIMES]).toEqual(['bun', 'node'])
})

test('HICODE_RUNTIME manda quando definido — 12-factor, o operador escolhe', () => {
  process.env.HICODE_RUNTIME = 'node'
  try {
    expect(R.runtimeDeScript()).toBe('node')
  } finally {
    delete process.env.HICODE_RUNTIME
  }
})

test('runtime desconhecido LANCA em vez de cair calado no padrao', () => {
  process.env.HICODE_RUNTIME = 'deno'
  try {
    expect(() => R.runtimeDeScript()).toThrow('deno')
  } finally {
    delete process.env.HICODE_RUNTIME
  }
})

test('sem env, escolhe o que existe no PATH — e diz qual escolheu e por que', () => {
  delete process.env.HICODE_RUNTIME
  const e = R.escolhaDeRuntime()
  expect([...R.RUNTIMES]).toContain(e.runtime)
  expect(e.motivo.length).toBeGreaterThan(10)
})

function arquivosTs(raiz: string): string[] {
  return readdirSync(raiz).flatMap(n => {
    const c = join(raiz, n)
    return statSync(c).isDirectory() ? arquivosTs(c) : (n.endsWith('.ts') ? [c] : [])
  })
}

const PODE_CITAR_BUN = new Set([
  join('motor', 'cdl', 'ali', 'runtime.ts'),
  join('motor', 'cdl', 'ali', 'ambiente.ts'),
  join('motor', 'cdl', 'bss', 'tipos.ts'),
  join('motor', 'cdl', 'bss', 'detectar.ts'),
  join('motor', 'cdl', 'bss', 'sondar.ts'),
])

test('INVARIANTE nenhum lugar do motor SPAWNA bun fixo — quem decide o runtime e runtime.ts', () => {
  const SPAWN = /(?:run|execFileSync|spawnSync|spawn)\(\s*'bun'/
  const culpados = [...arquivosTs('motor'), ...arquivosTs('bin')]
    .filter(f => !PODE_CITAR_BUN.has(f))
    .filter(f => SPAWN.test(readFileSync(f, 'utf8')))
  expect(culpados, 'runtime fixo no codigo quebra a promessa de rodar em node/pnpm/npm').toEqual([])
})

test('INVARIANTE nenhuma API Bun.* em codigo de runtime — o health server precisa subir em node tambem', () => {
  const culpados = [...arquivosTs('motor'), ...arquivosTs('bin')]
    .filter(f => /\bBun\.[a-z]/.test(readFileSync(f, 'utf8')))
  expect(culpados, 'Bun.serve nao existe em node — item 28 pede a mesma imagem em qualquer lugar').toEqual([])
})
