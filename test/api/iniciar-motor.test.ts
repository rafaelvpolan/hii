import { test, beforeEach, afterEach, expect } from '../apoio/runner.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { iniciarMotor } from '../../motor/api/iniciar-motor.ts'
import type { EstadoMotor } from '../../motor/api/estado-motor.ts'
let base = ''
const estado = (ligado = false): EstadoMotor => ({ protocolo: 1, estado: ligado ? 'ligado' : 'desligado', versao: '1.0.0', versaoEmExecucao: ligado ? '1.0.0' : null, fila: 'a'.repeat(64), consultadoEm: new Date().toISOString(), motivo: 'fixture' })
beforeEach(() => { base = mkdtempSync(join(tmpdir(), 'hii-iniciar-api-')); process.env.HII_RUNNER_LOCK = join(base, 'runner.lock') })
afterEach(() => { rmSync(base, { recursive: true, force: true }) })
test('duas chamadas concorrentes iniciam uma vez e aguardam confirmacao', async () => {
  let ligado = false, partidas = 0
  const deps = { consultar: () => estado(ligado), iniciar: () => { partidas++; return true }, aguardar: async () => { ligado = true }, prazoMs: 100 }
  const [a, b] = await Promise.all([iniciarMotor(deps), iniciarMotor(deps)])
  expect(partidas).toBe(1)
  expect(a.estado).toBe('ligado')
  expect(b.estado).toBe('ligado')
  await iniciarMotor(deps)
  expect(partidas).toBe(1)
})
test('binario ausente/falha nao vira ligado e repeticao tem backoff', async () => {
  let partidas = 0
  const deps = { consultar: () => estado(), iniciar: () => { partidas++; return false }, aguardar: async () => {}, prazoMs: 0 }
  await expect(iniciarMotor(deps)).rejects.toThrow('Motor nao iniciou')
  await expect(iniciarMotor(deps)).rejects.toThrow('60 segundos')
  expect(partidas).toBe(1)
})
test('exit zero sem presenca pronta nao e sucesso', async () => {
  await expect(iniciarMotor({ consultar: () => estado(), iniciar: () => true, aguardar: async () => {}, prazoMs: 0 })).rejects.toThrow('sem confirmacao')
})
test('estado desconhecido nao autoriza segundo daemon', async () => {
  let partidas = 0
  await expect(iniciarMotor({ consultar: () => ({ ...estado(), estado: 'desconhecido' }), iniciar: () => { partidas++; return true }, aguardar: async () => {}, prazoMs: 0 })).rejects.toThrow()
  expect(partidas).toBe(0)
})
