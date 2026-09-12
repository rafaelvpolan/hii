import { test, expect, afterAll, dormir } from '../apoio/runner.ts'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TEMPO_COM_GIT_MS } from '../tempo-de-teste.ts'
import type { AgentRequest } from '../../motor/tomada/tipos.ts'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-harness-pid-'))
const CARDS = join(BASE, 'cards')
const BIN = join(BASE, 'bin')
process.env.HICODE_CARDS_DIR = CARDS
mkdirSync(join(CARDS, 'runs'), { recursive: true })
mkdirSync(BIN, { recursive: true })

const RESULTADO = JSON.stringify({ type: 'result', subtype: 'success', result: 'ok', total_cost_usd: 0.01, is_error: false, usage: { input_tokens: 1, output_tokens: 1 } })
writeFileSync(join(BIN, 'claude'), `#!/bin/bash\nsleep 1\necho '${RESULTADO}'\n`)
chmodSync(join(BIN, 'claude'), 0o755)
const PATH_ORIGINAL = process.env.PATH ?? ''
process.env.PATH = `${BIN}:${PATH_ORIGINAL}`

const { runProvider } = await import('../../motor/euclides/tesouro/confianca.ts')
const { ClaudeProvider } = await import('../../motor/tomada/harness/claude.ts')
const { harnessesDoCard, pidVivo } = await import('../../motor/tomada/harness-em-voo.ts')
import type { HarnessRegistrado } from '../../motor/tomada/harness-em-voo.ts'
const { createCard } = await import('../../motor/cordel/store.ts')

afterAll(() => {
  process.env.PATH = PATH_ORIGINAL
  rmSync(BASE, { recursive: true, force: true })
})

function pedido(extra: Partial<AgentRequest> = {}): AgentRequest {
  return { prompt: 'diga ok', cwd: BASE, dirs: [], mode: 'edit', useAgents: false, timeoutMs: 20000, ...extra }
}

async function registroDurante(id: string): Promise<HarnessRegistrado | null> {
  const limite = Date.now() + 900
  while (Date.now() < limite) {
    const r = harnessesDoCard(id)[0]
    if (r) return r
    await dormir(25)
  }
  return null
}

for (const caminho of ['stream', 'json'] as const) {
  test(`REGRESSAO runProvider registra o pid do harness claude (${caminho}) enquanto roda e esquece ao terminar`, async () => {
    const id = createCard({ status: 'EXECUTING', title: 't', repo: 'org/app', risk: 'low' }, '## Objetivo\nx\n')
    const liveLog = caminho === 'stream' ? join(CARDS, 'runs', `${id}.live.log`) : undefined
    const promessa = runProvider(id, new ClaudeProvider(), pedido({ liveLog }), 'implement')
    const durante = await registroDurante(id)
    expect(durante, 'o registro tinha de existir com o harness em voo').not.toBeNull()
    if (!durante) return
    expect(durante.pid).toBeGreaterThan(0)
    expect(pidVivo(durante.pid), 'o pid registrado tem de ser um processo vivo').toBe(true)
    expect(durante.papel).toBe('implement')
    expect(Number.isNaN(Date.parse(durante.iniciadoEm))).toBe(false)
    const res = await promessa
    expect(res.ok, res.detail).toBe(true)
    expect(harnessesDoCard(id), 'harness terminado nao pode ficar registrado').toEqual([])
    expect(existsSync(join(CARDS, 'runs', `${id}.${durante.pid}.harness.pid`))).toBe(false)
  }, TEMPO_COM_GIT_MS)
}
