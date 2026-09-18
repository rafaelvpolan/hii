import { spawn } from 'node:child_process'
import { test, beforeEach, afterEach, expect } from '../apoio/runner.ts'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir, uptime } from 'node:os'
import { join } from 'node:path'
import { estadoMotor, publicarPresenca, acompanharPresenca } from '../../motor/api/estado-motor.ts'

let base = ''
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'hii-estado-motor-'))
  process.env.HII_RUNNER_LOCK = join(base, 'runner.lock')
  process.env.HII_CARDS_DIR = join(base, 'cards')
  mkdirSync(process.env.HII_CARDS_DIR)
})
afterEach(() => { rmSync(base, { recursive: true, force: true }) })
function registrar(): void {
  writeFileSync(process.env.HII_RUNNER_LOCK!, String(process.pid))
  publicarPresenca()
}
test('API pode estar viva com daemon desligado e informa versao instalada', () => {
  const s = estadoMotor()
  expect(s.estado).toBe('desligado')
  expect(s.versao).toMatch(/^\d+\.\d+\.\d+/)
  expect(s.versaoEmExecucao).toBe(null)
})
test('presenca recente e lock do processo comprovam ligado', () => {
  registrar()
  const s = estadoMotor()
  expect(s.estado).toBe('ligado')
  expect(s.versaoEmExecucao).toBe(s.versao)
})
test('PID vivo sozinho nao comprova disponibilidade', () => {
  writeFileSync(process.env.HII_RUNNER_LOCK!, String(process.pid))
  expect(estadoMotor().estado).toBe('desconhecido')
})
test('presenca antiga nao transforma processo travado em ligado', () => {
  registrar()
  const f = process.env.HII_RUNNER_LOCK! + '.estado.json'
  const p = JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>
  writeFileSync(f, JSON.stringify({ ...p, atualizado: Date.now() - 11000, monotonicMs: uptime() * 1000 - 11000 }))
  expect(estadoMotor().estado).toBe('desconhecido')
})
test('API nao declara ligado daemon com outra fila', () => {
  registrar()
  process.env.HII_CARDS_DIR = join(base, 'outra-fila')
  expect(estadoMotor().estado).toBe('desconhecido')
  expect(estadoMotor().motivo).toContain('filas diferentes')
})
test('daemon drenando/degradado nao e desligado nem disponivel', () => {
  registrar()
  const f = process.env.HII_RUNNER_LOCK! + '.estado.json'
  const p = JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>
  writeFileSync(f, JSON.stringify({ ...p, pronto: false }))
  expect(estadoMotor().estado).toBe('degradado')
})

test('falha de escrita da presenca nao interrompe o arranque do executor', () => {
  process.env.HII_RUNNER_LOCK = join(base, 'inexistente', 'runner.lock')
  const parar = acompanharPresenca()
  parar()
})

test('ajuste do relogio civil nao invalida presenca recente', () => {
  registrar()
  const f = process.env.HII_RUNNER_LOCK! + '.estado.json'
  const p = JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>
  for (const deslocamento of [-60000, 60000]) {
    writeFileSync(f, JSON.stringify({ ...p, atualizado: Date.now() + deslocamento }))
    expect(estadoMotor().estado).toBe('ligado')
  }
})

test('presenca de outro processo Node e lida pelo runtime atual mesmo com relogio civil alterado', async () => {
  const modulo = new URL('../../motor/api/estado-motor.ts', import.meta.url).href
  const codigo = "const fs = await import('node:fs'); const m = await import(" + JSON.stringify(modulo) + "); fs.writeFileSync(process.env.HII_RUNNER_LOCK, String(process.pid)); m.publicarPresenca(); process.stdout.write('pronto\\n'); setInterval(() => {}, 1000)"
  const filho = spawn('node', ['--input-type=module', '--eval', codigo], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('fixture nao publicou presenca')), 5000)
      filho.once('error', reject)
      filho.once('exit', code => { clearTimeout(timeout); reject(new Error('fixture encerrou: ' + code)) })
      filho.stdout.once('data', () => { clearTimeout(timeout); resolve() })
    })
    const file = process.env.HII_RUNNER_LOCK! + '.estado.json'
    const p = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    writeFileSync(file, JSON.stringify({ ...p, atualizado: Date.now() + 60000 }))
    expect(estadoMotor().estado).toBe('ligado')
    writeFileSync(file, JSON.stringify({ ...p, inicioNoKernel: 'processo-anterior' }))
    expect(estadoMotor().estado).toBe('desconhecido')
  } finally {
    const fim = new Promise<void>(resolve => filho.once('exit', () => resolve()))
    filho.kill('SIGTERM')
    if (filho.exitCode === null) await fim
  }
})
