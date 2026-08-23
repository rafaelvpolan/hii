import { test, expect, afterAll } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-cnd-'))
afterAll(() => {
  rmSync(BASE, { recursive: true, force: true })
  delete process.env.HICODE_TIER_FILE
})

const CND = await import('../../motor/cic/cnd/gauntlet')

test('com governanca valida, o gauntlet pode iniciar e sabe qual e o teto', () => {
  delete process.env.HICODE_TIER_FILE
  const p = CND.podeIniciar()
  expect(p.pode).toBe(true)
  expect(p.tetoUsd).toBeGreaterThan(0)
})

test('BOUNDARY sem teto de orcamento legivel, o gauntlet RECUSA iniciar', () => {
  const ruim = join(BASE, 'sem-teto.json')
  writeFileSync(ruim, JSON.stringify({ versao: 1, padrao: 'tier2_padrao', criterios: {} }))
  process.env.HICODE_TIER_FILE = ruim
  try {
    const p = CND.podeIniciar()
    expect(p.pode, 'sessao de gauntlet sem teto e o risco declarado do item 23').toBe(false)
    expect(p.motivo).toContain('orcamentoPorCard')
    expect(p.tetoUsd).toBe(0)
  } finally {
    delete process.env.HICODE_TIER_FILE
  }
})

test('BOUNDARY governanca ausente tambem recusa, em vez de assumir teto infinito', () => {
  process.env.HICODE_TIER_FILE = join(BASE, 'nao-existe.json')
  try {
    expect(CND.podeIniciar().pode).toBe(false)
  } finally {
    delete process.env.HICODE_TIER_FILE
  }
})

test('BOUNDARY tetoUsd que nao e numero finito positivo RECUSA — coercao do JS nao vale por teto', () => {
  const casos: Array<[string, string]> = [
    ['infinito por 1e400', '1e400'],
    ['array', '[5]'],
    ['booleano', 'true'],
    ['string numerica', '"5"'],
    ['hexadecimal em string', '"0x5"'],
    ['objeto', '{"valor":5}'],
  ]
  for (const [nome, bruto] of casos) {
    const caminho = join(BASE, `teto-${nome.replace(/\W+/g, '-')}.json`)
    writeFileSync(caminho, `{"versao":1,"padrao":"tier2_padrao","criterios":{},"orcamentoPorCard":{"tetoUsd":${bruto},"acaoAoEstourar":"pausar"}}`)
    process.env.HICODE_TIER_FILE = caminho
    try {
      const p = CND.podeIniciar()
      expect(p.pode, `${nome} nao e teto legivel — teto infinito e a ausencia de boundary com outro nome`).toBe(false)
      expect(p.tetoUsd).toBe(0)
    } finally {
      delete process.env.HICODE_TIER_FILE
    }
  }
})
