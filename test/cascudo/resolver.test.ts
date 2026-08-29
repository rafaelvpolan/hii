import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { gerarResolved, lerFontes, resolver } from '../../motor/cascudo/resolver.ts'

const criados: string[] = []
afterAll(() => { for (const d of criados) rmSync(d, { recursive: true, force: true }) })

function base(): string {
  const d = mkdtempSync(join(tmpdir(), 'hii-res-')); criados.push(d); return d
}

function por(raiz: string, origem: string, pack: string, id: string, corpo: string): void {
  mkdirSync(join(raiz, origem, pack, id), { recursive: true })
  writeFileSync(join(raiz, origem, pack, id, 'SKILL.md'), `---\nid: ${id}\npapeis: [implementador]\nsempre: true\n---\n${corpo}`)
}

const ORDEM = { versao: 1, ordem: ['_native', '_sources/ecc', '_sources/omc'], fontes: [] }

test('_native vence adaptacao externa no mesmo id', () => {
  const r = base()
  por(r, '_native', 'common', 'x', 'versao nativa')
  por(r, '_sources/ecc', 'common', 'x', 'versao do ecc')
  const res = resolver(r, ORDEM)
  expect(res.skills.length).toBe(1)
  expect(res.skills[0]?.instrucoes).toBe('versao nativa')
  expect(res.colisoes, 'empate COM _native e resolucao normal, nao colisao').toEqual([])
})

test('a ordem decide entre duas origens externas quando ha _native ausente... mas isso e COLISAO', () => {
  const r = base()
  por(r, '_sources/ecc', 'common', 'y', 'ecc')
  por(r, '_sources/omc', 'common', 'y', 'omc')
  const res = resolver(r, ORDEM)
  expect(res.colisoes.map(c => c.id)).toEqual(['y'])
  expect(res.colisoes[0]?.origens).toEqual(['_sources/ecc', '_sources/omc'])
})

test('REGRESSAO colisao entre externas FALHA o build — nao escolhe no escuro', () => {
  const r = base()
  por(r, '_sources/ecc', 'common', 'y', 'ecc')
  por(r, '_sources/omc', 'common', 'y', 'omc')
  expect(() => gerarResolved(r)).toThrow()
})

test('ids distintos de origens distintas convivem, contados por origem', () => {
  const r = base()
  por(r, '_native', 'common', 'a', 'a')
  por(r, '_sources/ecc', 'backend-web', 'b', 'b')
  const res = resolver(r, ORDEM)
  expect(res.skills.map(s => s.id)).toEqual(['a', 'b'])
  expect(res.porOrigem).toEqual({ _native: 1, '_sources/ecc': 1 })
})

test('_resolved e GERADA e marcada como tal — ninguem deve editar la', () => {
  const r = base()
  por(r, '_native', 'common', 'a', 'conteudo')
  gerarResolved(r)
  expect(existsSync(join(r, '_resolved', 'common', 'a', 'SKILL.md'))).toBe(true)
  const marca = readFileSync(join(r, '_resolved', '.gerado'), 'utf8')
  expect(marca).toContain('nao edite')
  expect(marca).toContain('skill-sources.json')
})

test('regerar apaga o que saiu da fonte — _resolved nao acumula lixo', () => {
  const r = base()
  por(r, '_native', 'common', 'a', 'a')
  por(r, '_native', 'common', 'b', 'b')
  gerarResolved(r)
  rmSync(join(r, '_native', 'common', 'b'), { recursive: true })
  gerarResolved(r)
  expect(existsSync(join(r, '_resolved', 'common', 'b'))).toBe(false)
  expect(existsSync(join(r, '_resolved', 'common', 'a'))).toBe(true)
})

test('REGRESSAO _native fora do primeiro lugar da ordem e recusado', () => {
  expect(() => resolver(base(), { versao: 1, ordem: ['_sources/ecc', '_native'], fontes: [] }))
    .toThrow()
})

test('o registro real do repo tem _native primeiro', () => {
  expect(lerFontes().ordem[0]).toBe('_native')
})

test('o _resolved versionado bate com o que o resolver produz hoje', () => {
  const res = resolver()
  expect(res.colisoes).toEqual([])
  expect(res.skills.length).toBeGreaterThan(8)
})
