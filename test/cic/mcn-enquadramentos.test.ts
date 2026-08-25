import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  lerEnquadramentos, escolherEnquadramentos, idsDeEnquadramento, arquivoDeEnquadramentos,
} from '../../motor/cic/mcn/enquadramentos.ts'
import { ENV_ENQUADRAMENTOS_FILE, CONTRATO_MOTOR_PAINEL } from '../../motor/cdl/ali/contrato.ts'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-mcn-'))
afterAll(() => {
  delete process.env[ENV_ENQUADRAMENTOS_FILE]
  rmSync(BASE, { recursive: true, force: true })
})

function comArquivo<T>(conteudo: string, fn: () => T): T {
  const caminho = join(BASE, `e-${Math.abs(conteudo.length)}-${conteudo.slice(0, 8).replace(/\W/g, '')}.json`)
  writeFileSync(caminho, conteudo)
  process.env[ENV_ENQUADRAMENTOS_FILE] = caminho
  try {
    return fn()
  } finally {
    delete process.env[ENV_ENQUADRAMENTOS_FILE]
  }
}

test('os enquadramentos sao DADO versionado, nao array dentro de um .ts', () => {
  const e = lerEnquadramentos()
  expect(e.versao).toBeGreaterThan(0)
  expect(e.enquadramentos.length).toBeGreaterThanOrEqual(e.minimoDeRamos)
  expect(arquivoDeEnquadramentos()).toContain('enquadramentos.json')
  for (const x of e.enquadramentos) {
    expect(x.id.trim().length, `enquadramento sem id: ${JSON.stringify(x)}`).toBeGreaterThan(0)
    expect(x.lente.trim().length, `enquadramento "${x.id}" sem lente`).toBeGreaterThan(0)
  }
})

test('a variavel do arquivo esta no contrato — env resolvida fora do contrato ninguem acha', () => {
  const v = CONTRATO_MOTOR_PAINEL.find(x => x.nome === ENV_ENQUADRAMENTOS_FILE)
  expect(v, 'HICODE_ENQUADRAMENTOS_FILE precisa estar em CONTRATO_MOTOR_PAINEL').toBeDefined()
  expect(v?.resolvidoPor).toContain('motor/cic/mcn/enquadramentos.ts')
})

test('arquivo ausente LANCA — nao cai numa lista embutida que ninguem versionou', () => {
  process.env[ENV_ENQUADRAMENTOS_FILE] = join(BASE, 'nao-existe.json')
  try {
    expect(() => lerEnquadramentos()).toThrow('nao encontrado')
  } finally {
    delete process.env[ENV_ENQUADRAMENTOS_FILE]
  }
})

test('arquivo ilegivel LANCA nomeando o problema', () => {
  comArquivo('{ isto nao e json', () => {
    expect(() => lerEnquadramentos()).toThrow('ilegivel')
  })
})

test('lista vazia LANCA — divergencia sem ramo nao e divergencia', () => {
  comArquivo(JSON.stringify({ versao: 1, enquadramentos: [] }), () => {
    expect(() => lerEnquadramentos()).toThrow('sem enquadramento nenhum')
  })
})

test('id repetido LANCA aqui, e nao la na apuracao — o VTO recusa lente duplicada', () => {
  const dois = { versao: 1, enquadramentos: [
    { id: 'a', nome: 'a', lente: 'x' },
    { id: 'a', nome: 'outro', lente: 'y' },
    { id: 'b', nome: 'b', lente: 'z' },
  ] }
  comArquivo(JSON.stringify(dois), () => {
    expect(() => lerEnquadramentos()).toThrow('repetido')
  })
})

test('enquadramento sem lente LANCA — lente vazia e um ramo que nao enquadra nada', () => {
  const cru = { versao: 1, enquadramentos: [{ id: 'a', nome: 'a', lente: '  ' }] }
  comArquivo(JSON.stringify(cru), () => {
    expect(() => lerEnquadramentos()).toThrow('sem id ou sem')
  })
})

test('minimoDeRamos abaixo de 2 LANCA — dois ramos ja sao o minimo para comparar', () => {
  const cru = { versao: 1, minimoDeRamos: 1, enquadramentos: [{ id: 'a', nome: 'a', lente: 'x' }] }
  comArquivo(JSON.stringify(cru), () => {
    expect(() => lerEnquadramentos()).toThrow('minimoDeRamos')
  })
})

test('menos lentes que o minimo LANCA na escolha — nao da para formar maioria', () => {
  const cru = { versao: 1, minimoDeRamos: 3, enquadramentos: [
    { id: 'a', nome: 'a', lente: 'x' },
    { id: 'b', nome: 'b', lente: 'y' },
  ] }
  comArquivo(JSON.stringify(cru), () => {
    expect(() => escolherEnquadramentos(3, 'semente')).toThrow('nao da para formar maioria')
  })
})

test('a escolha nunca desce abaixo do minimo, mesmo se pedirem 2', () => {
  const e = lerEnquadramentos()
  expect(escolherEnquadramentos(2, 'x', e).length).toBe(e.minimoDeRamos)
})

test('a escolha nunca repete lente e nunca passa do que existe', () => {
  const e = lerEnquadramentos()
  const todos = escolherEnquadramentos(999, 'semente', e)
  expect(todos.length).toBe(e.enquadramentos.length)
  expect(new Set(todos.map(x => x.id)).size).toBe(todos.length)
})

test('sementes diferentes escolhem conjuntos diferentes — senao a lente seria fixa', () => {
  const e = lerEnquadramentos()
  const conjuntos = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map(s => escolherEnquadramentos(3, s, e).map(x => x.id).join(',')))
  expect(conjuntos.size, 'toda semente caindo no mesmo conjunto tornaria o enquadramento decorativo').toBeGreaterThan(1)
})

test('idsDeEnquadramento devolve exatamente o que esta no arquivo', () => {
  const e = lerEnquadramentos()
  expect(idsDeEnquadramento(e)).toEqual(e.enquadramentos.map(x => x.id))
})
