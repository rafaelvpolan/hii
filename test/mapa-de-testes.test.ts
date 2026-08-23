import { test, expect } from 'bun:test'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
// hicode:allow-any — o script de rename e .mjs; a fronteira e checada aqui.
import { caminhosNaoAlcancaveis } from '../scripts/renomear-testes-brazil.mjs'

const DOMINIOS = ['agentes', 'cdl', 'cic', 'euc', 'mir', 'nmy', 'osw', 'qlb', 'tmd']
// Só o que não exercita motor/ fica na raiz: guardas do próprio repositório.
const NA_RAIZ = [
  'isolamento-de-testes.test.ts',
  'mapa-de-rename.test.ts',
  'mapa-de-testes.test.ts',
  'no-any-detect.test.ts',
  'scripts-setup-imports.test.ts',
]

function testesEm(dir: string): string[] {
  return readdirSync(dir).filter(n => n.endsWith('.test.ts'))
}

test('a raiz de test/ so guarda os testes que nao exercitam motor/', () => {
  expect(testesEm('test').sort()).toEqual([...NA_RAIZ].sort())
})

test('toda subpasta de test/ espelha um dominio de motor/', () => {
  const pastas = readdirSync('test').filter(n => statSync(join('test', n)).isDirectory() && n !== 'fixtures')
  expect(pastas.sort()).toEqual([...DOMINIOS].sort())
})

test('INVARIANTE nenhum teste calcula a raiz do repo com um unico ".."', () => {
  const profundidade = caminhosNaoAlcancaveis().filter((m: { motivo: string }) => m.motivo.includes("unico"))
  expect(profundidade, 'teste em subpasta com raiz de um nivel aponta para test/, nao para o repo').toEqual([])
})

test('a varredura enxerga os arquivos — senao o invariante passaria vazio', () => {
  const total = DOMINIOS.reduce((n, d) => n + testesEm(join('test', d)).length, 0)
  expect(total).toBeGreaterThan(140)
})
