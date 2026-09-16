import { test, expect, beforeEach, afterEach } from '../apoio/runner.ts'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runGatedReview } from '../../motor/ciclo/crivo/gate.ts'
import { providerFor } from '../../motor/tomada/registro.ts'
import { emptyUsage } from '../../motor/tomada/uso.ts'
import { GATE_DIFF_LIMIT } from '../../motor/cordel/alicerce/config.ts'

let dir = ''
let env: NodeJS.ProcessEnv
beforeEach(() => {
  env = { ...process.env }
  dir = mkdtempSync(join(tmpdir(), 'hii-gate-hardening-'))
  process.env.HII_CARDS_DIR = join(dir, '.git', 'estado')
  process.env.HII_IA_FILE = join(dir, '.git', 'ia.json')
  process.env.HII_GATE_PROVIDER = 'claude'
  execFileSync('git', ['init', '-q', dir])
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'base'])
  execFileSync('git', ['-C', dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD'])
})
afterEach(() => { process.env = env; rmSync(dir, { recursive: true, force: true }) })

test('diff truncado bloqueia antes de consumir inferencia', async () => {
  writeFileSync(join(dir, 'grande.txt'), 'linha\n'.repeat(Math.ceil(GATE_DIFF_LIMIT / 5) + 100))
  const h = providerFor('gate')
  const original = h.run
  let chamadas = 0
  h.run = async () => { chamadas++; throw new Error('nao deve chamar') }
  try {
    const r = await runGatedReview(dir, 'main', 'revisar')
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('excede o limite')
    expect(chamadas).toBe(0)
  } finally { h.run = original }
})

test('isError com texto APPROVED nunca libera o gate', async () => {
  writeFileSync(join(dir, 'pequeno.txt'), 'mudanca')
  const h = providerFor('gate')
  const original = h.run
  h.run = async () => ({ ok: false, failed: false, isError: true, timedOut: false,
    text: '{"verdict":"APPROVED","reason":"passou","questions":[]}', detail: 'erro do provedor',
    cost: 0.1, costMeasured: true, usage: emptyUsage() })
  try {
    const r = await runGatedReview(dir, 'main', 'revisar')
    expect(r.ok).toBe(false)
    expect(r.cost).toBe(0.1)
    expect(r.reason).toContain('NAO executou')
  } finally { h.run = original }
})

test('resposta atrasada nao aprova trabalho alterado durante a chamada', async () => {
  writeFileSync(join(dir, 'pequeno.txt'), 'primeira versao')
  const h = providerFor('gate')
  const original = h.run
  h.run = async () => {
    writeFileSync(join(dir, 'pequeno.txt'), 'segunda versao nao revisada')
    return { ok: true, failed: false, isError: false, timedOut: false,
      text: '{"verdict":"APPROVED","reason":"passou","questions":[]}', detail: '',
      cost: 0.1, costMeasured: true, usage: emptyUsage() }
  }
  try {
    const r = await runGatedReview(dir, 'main', 'revisar')
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('parecer antigo invalidado')
    expect(r.cost).toBe(0.1)
  } finally { h.run = original }
})
