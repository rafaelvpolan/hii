import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-fre-'))
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const C = await import('../../motor/csd/fre/candidatos.ts')

let n = 0
const alvo = (): string => join(BASE, `alvo-${n++}`)
const ASSIN = 'seguranca-laravel-gate-reprovado-payment-sem-teste'

test('duas ocorrencias NAO atingem o limiar — falha isolada e ruido, nao padrao', () => {
  const a = alvo()
  C.registrarOcorrencia(a, { assinatura: ASSIN, categoria: 'seguranca', card: '041', evidencia: 'gate seguranca reprovou' })
  const c = C.registrarOcorrencia(a, { assinatura: ASSIN, categoria: 'seguranca', card: '058', evidencia: 'mesma classe de achado' })
  expect(c.ocorrencias.length).toBe(2)
  expect(C.atingiuLimiar(c)).toBe(false)
  expect(C.prontosParaRevisao(a)).toEqual([])
})

test('tres cards diferentes propoem — e a proposta espera humano, nao promove sozinha', () => {
  const a = alvo()
  for (const card of ['041', '058', '073']) {
    C.registrarOcorrencia(a, { assinatura: ASSIN, categoria: 'seguranca', card, evidencia: `gate reprovou no card ${card}` })
  }
  const prontos = C.prontosParaRevisao(a)
  expect(prontos.length).toBe(1)
  expect(prontos[0]?.promovido, 'promover sozinho seria virar regra sem decisao humana').toBe(false)
})

test('o MESMO card tres vezes NAO atinge o limiar — um card instavel nao inventa um padrao', () => {
  const a = alvo()
  for (let i = 0; i < 3; i++) {
    C.registrarOcorrencia(a, { assinatura: ASSIN, categoria: 'seguranca', card: '041', evidencia: `tentativa ${i}` })
  }
  const c = C.candidatos(a)[0]
  expect(c?.ocorrencias.length, 'ocorrencia e por card, nao por evento').toBe(1)
  expect(C.atingiuLimiar(c!)).toBe(false)
})

test('assinaturas diferentes acumulam separado', () => {
  const a = alvo()
  C.registrarOcorrencia(a, { assinatura: ASSIN, categoria: 'seguranca', card: '041', evidencia: 'x' })
  C.registrarOcorrencia(a, { assinatura: 'build-laravel-falhou-composer', categoria: 'build', card: '041', evidencia: 'y' })
  expect(C.candidatos(a).length).toBe(2)
})

test('o candidato guarda EVIDENCIA do diario, nao opiniao — sem evidencia LANCA', () => {
  const a = alvo()
  expect(() => C.registrarOcorrencia(a, { assinatura: ASSIN, categoria: 'seguranca', card: '041', evidencia: '' })).toThrow('evidencia')
  C.registrarOcorrencia(a, { assinatura: ASSIN, categoria: 'seguranca', card: '041', evidencia: 'gate_verdict seguranca: reprovou' })
  expect(C.candidatos(a)[0]?.ocorrencias[0]?.evidencia).toContain('gate_verdict')
})

test('arquivo de candidato ilegivel LANCA em vez de virar "nenhum candidato"', () => {
  const a = alvo()
  C.registrarOcorrencia(a, { assinatura: ASSIN, categoria: 'seguranca', card: '041', evidencia: 'x' })
  require('node:fs').writeFileSync(join(a, '.hii', 'candidatos-regras', `${ASSIN}.json`), '{{{')
  expect(() => C.candidatos(a)).toThrow('ilegivel')
})
