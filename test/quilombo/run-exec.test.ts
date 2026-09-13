import { test, expect } from '../apoio/runner.ts'
import { run } from '../../motor/quilombo/git.ts'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SONO_DO_FILHO_S = 60
const TETO_PARA_VOLTAR_MS = 10000

test('run mata o processo no timeout (err.killed) e volta MUITO antes de o filho terminar sozinho', async () => {
  const t0 = Date.now()
  const { err } = await run('sleep', [String(SONO_DO_FILHO_S)], { timeout: 400 })
  const elapsed = Date.now() - t0
  expect(err?.killed).toBe(true)
  expect(elapsed, `voltou em ${elapsed}ms; o filho dormiria ${SONO_DO_FILHO_S * 1000}ms`).toBeLessThan(TETO_PARA_VOLTAR_MS)
}, 60000)

test('run ignora stdin: CLI nao interpreta o prompt como entrada adicional', async () => {
  const script = "import { fstatSync } from 'node:fs'; process.stdout.write(fstatSync(0).isFIFO() ? 'stdin-pipe' : 'stdin-ignorado')"
  const { err, stdout } = await run(process.execPath, ['--input-type=module', '-e', script], { timeout: 5000 })
  expect(err).toBeNull()
  expect(stdout).toBe('stdin-ignorado')
})

test('run mata o grupo inteiro no timeout, inclusive o processo filho do wrapper', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hicode-run-group-'))
  const pidFile = join(dir, 'child.pid')
  const script = 'sleep 60 & echo $! > "$1"; wait'
  try {
    const resultado = await run('sh', ['-c', script, 'sh', pidFile], { timeout: 400 })
    expect(resultado.err?.killed).toBe(true)
    const pid = Number(readFileSync(pidFile, 'utf8'))
    let morto = false
    for (let i = 0; i < 40; i++) {
      try {
        const state = readFileSync(`/proc/${pid}/status`, 'utf8')
        if (/^State:\s+Z/m.test(state)) { morto = true; break }
        process.kill(pid, 0)
      } catch { morto = true; break }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    expect(morto, `o processo descendente ${pid} sobreviveu ao timeout`).toBe(true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}, 60000)

test('run injeta env git nao-interativo (GIT_EDITOR=true)', async () => {
  const { stdout } = await run('git', ['var', 'GIT_EDITOR'])
  expect(stdout.trim()).toBe('true')
})

test('run injeta GIT_TERMINAL_PROMPT=0', async () => {
  const { stdout } = await run('printenv', ['GIT_TERMINAL_PROMPT'])
  expect(stdout.trim()).toBe('0')
})

test('run sem timeout roda normal e sem err', async () => {
  const { err, stdout } = await run('echo', ['ok'])
  expect(err).toBeNull()
  expect(stdout.trim()).toBe('ok')
})
