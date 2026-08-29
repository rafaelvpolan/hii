import { test, expect, beforeEach, afterAll } from '../apoio/runner.ts'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// TTL longo de proposito: os testes de "dentro da janela" assumem que chamadas
// adjacentes caem no mesmo TTL, e com 300ms bastava uma pausa de GC entre elas
// para o cache expirar sozinho. Quem vira a janela agora e esquecerLoteEmCache,
// nao o relogio.
const TTL_MS = 60_000
process.env.HICODE_COTA_TTL_MS = String(TTL_MS)

const { lerCota } = await import('../../motor/euclides/tesouro/cota.ts')
const { esquecerLoteEmCache } = await import('../../motor/euclides/tesouro/cota-runs.ts')

const HORA_MS = 60 * 60 * 1000
const MTIME_FIXO_S = 1_000_000
const criados: string[] = []
let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hicode-cota-cache-'))
  criados.push(dir)
  process.env.HICODE_CARDS_DIR = dir
  mkdirSync(join(dir, 'runs'), { recursive: true })
})

afterAll(() => {
  for (const d of criados) rmSync(d, { recursive: true, force: true })
})

function agora(): number {
  return Math.floor(Date.now() / 1000) * 1000
}

function conteudoDeRun(id: string, quandoMs: number, custo: string): string {
  return JSON.stringify({
    id,
    ts: new Date(quandoMs).toISOString().replace(/\.\d+Z$/, 'Z'),
    ok: true,
    cost_usd: custo,
    duration_s: 10,
    tokens_in: 0,
    tokens_out: 0,
    tokens_cache_create: 0,
    tokens_cache_read: 0,
    tokens_total: 100,
    steps: null,
    provider: 'claude',
    model: 'opus',
    failure_class: '',
    failure_reason: '',
  }, null, 2)
}

function gravarRun(id: string, quandoMs: number, custo: string): string {
  const nome = `${id}-${new Date(quandoMs).toISOString().replace(/[^0-9]/g, '').slice(0, 14)}.json`
  const caminho = join(dir, 'runs', nome)
  writeFileSync(caminho, conteudoDeRun(id, quandoMs, custo))
  return caminho
}

// Vira a janela do cache de forma deterministica, em vez de dormir esperando o
// TTL. Ver o comentario em esquecerLoteEmCache.
function passarAJanela(): void {
  esquecerLoteEmCache()
}

test('dentro da janela do cache a leitura nao volta ao disco, e passada a janela o run reescrito aparece', async () => {
  const quando = agora() - HORA_MS
  const caminho = gravarRun('001', quando, '2.0000')
  expect(lerCota(agora()).custoUsd).toBe(2)

  writeFileSync(caminho, conteudoDeRun('001', quando, '7.50'))
  expect(lerCota(agora()).custoUsd).toBe(2)

  passarAJanela()
  expect(lerCota(agora()).custoUsd).toBe(7.5)
})

test('passada a janela, arquivo intacto NAO e lido de novo — a chave e ino+mtime+size', async () => {
  const quando = agora() - HORA_MS
  const caminho = gravarRun('001', quando, '2.0000')
  utimesSync(caminho, MTIME_FIXO_S, MTIME_FIXO_S)
  expect(lerCota(agora()).custoUsd).toBe(2)

  const corrompidoDoMesmoTamanho = conteudoDeRun('001', quando, '2.0000').replace('{', ' ')
  writeFileSync(caminho, corrompidoDoMesmoTamanho)
  utimesSync(caminho, MTIME_FIXO_S, MTIME_FIXO_S)

  passarAJanela()
  const cota = lerCota(agora())
  expect(cota.custoUsd).toBe(2)
  expect(cota.runsIgnorados).toBe(0)
})

test('mtime diferente invalida o parse guardado', async () => {
  const quando = agora() - HORA_MS
  const caminho = gravarRun('001', quando, '2.0000')
  utimesSync(caminho, MTIME_FIXO_S, MTIME_FIXO_S)
  expect(lerCota(agora()).custoUsd).toBe(2)

  writeFileSync(caminho, conteudoDeRun('001', quando, '7.5000'))
  utimesSync(caminho, MTIME_FIXO_S + 60, MTIME_FIXO_S + 60)

  passarAJanela()
  expect(lerCota(agora()).custoUsd).toBe(7.5)
})

test('run novo so entra quando a janela do cache vira', async () => {
  gravarRun('001', agora() - HORA_MS, '1.0000')
  expect(lerCota(agora()).runs).toBe(1)

  gravarRun('002', agora() - HORA_MS + 1000, '1.0000')
  expect(lerCota(agora()).runs).toBe(1)

  passarAJanela()
  expect(lerCota(agora()).runs).toBe(2)
})

test('trocar o diretorio de cards derruba o cache na hora', () => {
  gravarRun('001', agora() - HORA_MS, '3.0000')
  expect(lerCota(agora()).custoUsd).toBe(3)

  const outro = mkdtempSync(join(tmpdir(), 'hicode-cota-cache-'))
  criados.push(outro)
  process.env.HICODE_CARDS_DIR = outro
  mkdirSync(join(outro, 'runs'), { recursive: true })
  expect(lerCota(agora()).custoUsd).toBe(0)
})
