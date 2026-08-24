import { test, expect } from 'bun:test'

const C = await import('../../motor/agentes/clr/doc-updater')

test('mudanca em export publico afeta contrato', () => {
  const v = C.contratoPublicoMudou({
    arquivos: ['motor/csd/acervo.ts'],
    diff: '+export function carregarAcervo(): Skill[] {\n-export function antigo() {}',
  })
  expect(v.mudou).toBe(true)
  expect(v.motivos.join(' ')).toContain('export')
})

test('rota e endpoint afetam contrato mesmo sem export novo', () => {
  const v = C.contratoPublicoMudou({ arquivos: ['app/Http/routes/api.php'], diff: '+Route::get(...)' })
  expect(v.mudou).toBe(true)
})

test('mudanca so de corpo de funcao NAO afeta contrato — doc nao precisa mexer', () => {
  const v = C.contratoPublicoMudou({ arquivos: ['motor/csd/acervo.ts'], diff: '+  const x = 1\n-  const x = 0' })
  expect(v.mudou).toBe(false)
  expect(v.docsSugeridos).toEqual([])
})

test('mudanca de esquema de config afeta contrato — quem le o arquivo esta fora do repo', () => {
  const v = C.contratoPublicoMudou({ arquivos: ['config/model-tier.json'], diff: '+  "novoCampo": 1' })
  expect(v.mudou).toBe(true)
})

test('quando afeta, sugere QUAIS docs — apontar "atualize a doc" sem dizer onde nao ajuda', () => {
  const v = C.contratoPublicoMudou({ arquivos: ['motor/csd/acervo.ts'], diff: '+export function novo() {}' })
  expect(v.docsSugeridos.length).toBeGreaterThan(0)
  expect(v.docsSugeridos).toContain('README.md')
})

test('a decisao e deterministica e nao chama modelo', async () => {
  const fonte = await Bun.file('motor/agentes/clr/doc-updater.ts').text()
  expect(fonte).not.toContain('runProvider')
})

test('relato diz o que mudou e onde mexer', () => {
  const v = C.contratoPublicoMudou({ arquivos: ['config/pipeline.json'], diff: '+  "id": "novo"' })
  const r = C.relatoDeContrato(v)
  expect(r).toContain('pipeline.json')
  expect(C.relatoDeContrato({ mudou: false, motivos: [], docsSugeridos: [] })).toContain('nao mexe')
})
