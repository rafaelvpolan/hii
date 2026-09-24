import { test, expect, beforeEach, afterEach } from '../apoio/runner.ts'
import { admitirInferencia, ocupacaoDaInferencia } from '../../motor/tomada/capacidade-inferencia.ts'
import { providerFor } from '../../motor/tomada/registro.ts'
import type { AgentRequest, Harness } from '../../motor/tomada/tipos.ts'
import { runProvider } from '../../motor/euclides/tesouro/confianca.ts'
import { classifyFailure } from '../../motor/ciclo/reprise/classe-de-falha.ts'
import { emptyUsage } from '../../motor/tomada/uso.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dir = ''
let env: NodeJS.ProcessEnv
beforeEach(() => { env = { ...process.env }; dir = mkdtempSync(join(tmpdir(), 'hii-capacidade-')); process.env.HII_CARDS_DIR = join(dir, 'cards') })
afterEach(() => { process.env = env; rmSync(dir, { recursive: true, force: true }) })

function harness(slotsServidor = 1, slotsModelo = 1): Harness {
  const base = providerFor('implement', 'claude')
  return Object.assign(Object.create(base) as Harness, {
    recursoDeInferencia: (modelo: string | undefined) => ({ servidor: 'fixture:11434', modelo: modelo || 'm1', slotsServidor, slotsModelo }),
  })
}

test('reserva limita servidor e modelo e libera uma unica vez', () => {
  const h = harness(2, 1)
  const a = admitirInferencia(h, 'm1')
  expect(a.admitida).toBe(true)
  expect(admitirInferencia(h, 'm1').admitida).toBe(false)
  const b = admitirInferencia(h, 'm2')
  expect(b.admitida).toBe(true)
  expect(admitirInferencia(h, 'm3').admitida).toBe(false)
  expect(ocupacaoDaInferencia().chamadas).toBe(2)
  if (a.admitida) { a.liberar(); a.liberar() }
  if (b.admitida) b.liberar()
  expect(ocupacaoDaInferencia()).toEqual({ servidores: 0, modelos: 0, chamadas: 0 })
})

test('configuracao invalida bloqueia sem reservar', () => {
  const r = admitirInferencia(harness(0, 0), 'm1')
  expect(r.admitida).toBe(false)
  expect(r.admitida ? '' : r.motivo).toContain('configuracao invalida')
  expect(ocupacaoDaInferencia().chamadas).toBe(0)
})

test('runProvider nao chama harness quando ocupado e libera depois da conclusao', async () => {
  let liberar!: () => void
  let iniciou!: () => void
  const espera = new Promise<void>(resolve => { liberar = resolve })
  const inicio = new Promise<void>(resolve => { iniciou = resolve })
  let chamadas = 0
  const h = harness()
  h.run = async () => {
    chamadas++
    if (chamadas === 1) { iniciou(); await espera }
    return { ok: true, failed: false, timedOut: false, isError: false, detail: '', text: 'ok', cost: 0, costMeasured: true, usage: emptyUsage() }
  }
  const req: AgentRequest = { prompt: 'fixture', cwd: dir, dirs: [dir], mode: 'edit', useAgents: false, model: 'm1', timeoutMs: 1000 }
  const primeira = runProvider('', h, req, 'implement')
  await inicio
  const ocupada = await runProvider('', h, req, 'implement')
  expect(ocupada.ok).toBe(false)
  expect(chamadas).toBe(1)
  expect(classifyFailure(h, { timedOut: ocupada.timedOut, detail: ocupada.detail, text: ocupada.text }).failureClass).toBe('transient')
  liberar()
  expect((await primeira).ok).toBe(true)
  expect((await runProvider('', h, req, 'implement')).ok).toBe(true)
  expect(chamadas).toBe(2)
  expect(ocupacaoDaInferencia().chamadas).toBe(0)
})
