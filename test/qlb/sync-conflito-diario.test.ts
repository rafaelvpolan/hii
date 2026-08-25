import { test, expect, afterAll, lerArquivo } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-conflito-diario-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(join(process.env.HICODE_CARDS_DIR, 'runs'), { recursive: true })
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const { FASE_DO_CONFLITO } = await import('../../motor/qlb/ctr/sync.ts')
const { anexarEvento } = await import('../../motor/euc/eventos.ts')
const APR = await import('../../motor/csd/fre/aprendiz.ts')
const C = await import('../../motor/csd/fre/candidatos.ts')

test('INVARIANTE cada tentativa de resolucao emite repair_attempt no diario', async () => {
  const fonte = await lerArquivo('motor/qlb/ctr/sync.ts')
  expect(fonte).toContain("evento: 'repair_attempt', fase: FASE_DO_CONFLITO")
})

test('INVARIANTE o fim do laco emite veredicto, tanto no sucesso quanto no teto esgotado', async () => {
  const fonte = await lerArquivo('motor/qlb/ctr/sync.ts')
  const veredictos = fonte.split('\n').filter(l => l.includes("evento: 'gate_verdict'") && l.includes('FASE_DO_CONFLITO'))
  expect(veredictos.length, 'sucesso, commit falhado e teto esgotado — tres saidas, tres veredictos').toBe(3)
})

test('INVARIANTE o laco NAO migrou para repararAteOTeto — a abstracao nao serve para conflito', async () => {
  const fonte = await lerArquivo('motor/qlb/ctr/sync.ts')
  expect(fonte, 'GateReparavel modela verificacao re-executavel, e conflito nao tem').not.toContain('repararAteOTeto(')
})

test('conflito recorrente agora chega ao aprendiz como candidato a regra', async () => {
  const alvo = join(BASE, 'alvo-conflito')
  anexarEvento({ card: 'cfl-1', evento: 'gate_verdict', fase: FASE_DO_CONFLITO, detalhe: 'falhou: teto de 2 tentativas de resolucao esgotado' })
  await APR.aprendizFechaCard('cfl-1', { alvo, dominio: 'laravel' })
  const cs = C.candidatos(alvo)
  expect(cs.length, 'sem evento no diario, conflito recorrente era invisivel para o aprendiz').toBe(1)
  expect(cs[0]?.assinatura).toContain('conflito')
})

test('conflito resolvido NAO gera candidato — so o que falhou vira padrao', async () => {
  const alvo = join(BASE, 'alvo-ok')
  anexarEvento({ card: 'cfl-2', evento: 'gate_verdict', fase: FASE_DO_CONFLITO, detalhe: 'ok: conflito resolvido' })
  await APR.aprendizFechaCard('cfl-2', { alvo, dominio: 'laravel' })
  expect(C.candidatos(alvo)).toEqual([])
})
