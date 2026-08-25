import { test, expect, afterAll, rodar, dormir } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TEMPO_COM_GIT_MS } from '../tempo-de-teste.ts'

const REPO = join(import.meta.dirname, '..', '..')
const BASE = mkdtempSync(join(tmpdir(), 'hicode-shutproc-'))
mkdirSync(join(BASE, 'cards', 'runs'), { recursive: true })
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const LOCK = join(BASE, 'runner.lock')

function ambiente(): Record<string, string> {
  return {
    ...process.env as Record<string, string>,
    HICODE_CARDS_DIR: join(BASE, 'cards'),
    HICODE_REPOS_FILE: join(BASE, 'repos.json'),
    HICODE_RUNNER_PIDFILE: join(BASE, 'runner.pid'),
    HICODE_RUNNER_LOCK: LOCK,
    HICODE_CONCURRENCY: '0',
    HICODE_POLL_MS: '1000',
  }
}

async function esperar(cond: () => boolean, tetoMs: number): Promise<boolean> {
  const limite = Date.now() + tetoMs
  while (Date.now() < limite) {
    if (cond()) return true
    await dormir(50)
  }
  return false
}

// Este teste sobe o runner.ts DE VERDADE, como processo separado, porque o
// defeito que ele guarda so existe no despacho real de sinal: holdInstanceLock
// registrava um handler de SIGTERM com process.exit(0) ANTES do encerramento
// gracioso, entao o daemon morria sem drenar a fila. Todo teste unitario
// passava, porque chamava encerrarComGraca direto.
test('REGRESSAO SIGTERM no daemon real dispara o encerramento gracioso, nao um exit seco', async () => {
  // A saida do processo e acumulada pela propria ponte, entao nao ha arquivo
  // intermediario nem `flush` para esquecer — o que a versao anterior precisava
  // porque escrevia o stream num arquivo para depois le-lo de volta.
  const proc = rodar(['bun', 'runner.ts'], { cwd: REPO, env: ambiente() })
  const log = (): string => proc.saidaPadrao()

  const subiu = await esperar(() => log().includes('runner ativo'), 20_000)
  expect(subiu, `daemon nao subiu. log:\n${log()}`).toBe(true)

  proc.kill('SIGTERM')
  const drenou = await esperar(() => log().includes('fila drenada'), 15_000)
  await proc.encerrou

  expect(drenou, `o gracioso nao rodou — outro handler saiu antes. log:\n${log()}`).toBe(true)
  expect(log()).toContain('SIGTERM recebido')
  expect(proc.exitCode, 'fila vazia deve encerrar limpo').toBe(0)
  expect(existsSync(LOCK), 'a trava de instancia tem de ser liberada no caminho gracioso').toBe(false)
}, TEMPO_COM_GIT_MS)
