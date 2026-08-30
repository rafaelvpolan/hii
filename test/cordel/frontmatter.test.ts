import { test, expect } from '../apoio/runner.ts'
import { splitFrontMatter, serializeCard, extractObjetivo, umaLinha } from '../../motor/cordel/index.ts'

test('splitFrontMatter le frontmatter e corpo', () => {
  const p = splitFrontMatter('---\nid: 001\nstatus: READY\n---\n\n## Objetivo\nfazer X\n')
  expect(p.fm.id).toBe('001')
  expect(p.fm.status).toBe('READY')
  expect(p.body).toContain('## Objetivo')
})

test('serializeCard preserva ordem das chaves', () => {
  const out = serializeCard({ id: '2', status: 'READY' }, ['id', 'status'], 'corpo')
  expect(out.indexOf('id: 2')).toBeLessThan(out.indexOf('status: READY'))
})

test('extractObjetivo pega o bloco de Objetivo', () => {
  expect(extractObjetivo('## Objetivo\nmeu alvo\n\n## Outro\nx')).toBe('meu alvo')
})

// --- casos de borda gerados por IA local (generativo/runs/casos-frontmatter-*.md)
// e CORRIGIDOS na revisao: o modelo errou 4 das 10 expectativas. Os testes
// abaixo refletem o codigo, nao o rascunho — o funil de GENERATIVO-OLLAMA.md.

test('texto sem front-matter volta inteiro no body, sem fm e sem order', () => {
  expect(splitFrontMatter('')).toEqual({ fm: {}, order: [], body: '' })
  expect(splitFrontMatter('Conteudo do card')).toEqual({ fm: {}, order: [], body: 'Conteudo do card' })
})

test('front-matter vazio ("---\n---") NAO e parseado: a regex exige "\n---" apos o corpo', () => {
  // O rascunho generativo afirmou que o body sairia sem os marcadores; o codigo
  // nao casa a regex e devolve o texto inteiro como body.
  const r = splitFrontMatter('---\n---\nConteudo do card')
  expect(r.fm).toEqual({})
  expect(r.order).toEqual([])
  expect(r.body).toBe('---\n---\nConteudo do card')
})

test('order segue a ORDEM DE ENCONTRO, nao alfabetica', () => {
  const r = splitFrontMatter('---\nkey3: value3\nkey1: value1\n---\nbody')
  expect(r.order).toEqual(['key3', 'key1'])
})

test('linha sem dois-pontos dentro do front-matter e ignorada (i > 0)', () => {
  const r = splitFrontMatter('---\nsemcolocam\nkey: value\n---\nbody')
  expect(r.fm).toEqual({ key: 'value' })
  expect(r.order).toEqual(['key'])
})

test('serializeCard com fm vazio e order vazia emite linha em branco entre os marcadores', () => {
  // O rascunho generativo omitiu a linha vazia do join de array vazio.
  expect(serializeCard({}, [], 'Conteudo do card')).toBe('---\n\n---\n\nConteudo do card')
})

test('serializeCard com order apontando para campo ausente serializa o valor vazio', () => {
  expect(serializeCard({}, ['key'], 'Conteudo do card')).toBe('---\nkey: \n---\n\nConteudo do card')
})

test('umaLinha achata quebras e colapsa espacos — valor de campo nunca quebra o front-matter', () => {
  expect(umaLinha('linha1\nlinha2\r\nlinha3')).toBe('linha1 linha2 linha3')
  expect(umaLinha('  a   b  ')).toBe('a b')
  expect(umaLinha(undefined)).toBe('')
})

test('roundtrip: parse seguido de serialize preserva campos e body', () => {
  const original = '---\ntitle: algo\nstatus: EXECUTING\n---\n\n## Objetivo\ntexto\n'
  const { fm, order, body } = splitFrontMatter(original)
  expect(serializeCard(fm, order, body)).toBe(original)
})
