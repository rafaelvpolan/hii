import { test, expect, afterAll } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { arquivoDeCriterios, idsDeCriterio, lerCriterios, renderizarCriterios } from '../../motor/cic/crv/criterios.ts'

const criados: string[] = []
afterAll(() => { for (const d of criados) rmSync(d, { recursive: true, force: true }) })

function comCriterios<T>(conteudo: string | null, corpo: () => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'hii-crit-')); criados.push(dir)
  const arquivo = join(dir, 'crit.json')
  if (conteudo !== null) writeFileSync(arquivo, conteudo)
  const anterior = process.env.HICODE_CRITERIOS_FILE
  process.env.HICODE_CRITERIOS_FILE = arquivo
  try { return corpo() } finally {
    if (anterior === undefined) delete process.env.HICODE_CRITERIOS_FILE
    else process.env.HICODE_CRITERIOS_FILE = anterior
  }
}

test('o criterio real do repo carrega e tem id em todo item', () => {
  const c = lerCriterios()
  expect(c.criterios.length).toBeGreaterThan(4)
  for (const x of c.criterios) {
    expect(x.id, `criterio sem id: ${x.titulo}`).not.toBe('')
    expect(x.checa).not.toBe('')
  }
  expect(new Set(idsDeCriterio(c)).size, 'id repetido tornaria a reprovacao ambigua').toBe(c.criterios.length)
})

test('a matriz de cenario do item 21 esta declarada, com os quatro obrigatorios sempre', () => {
  const c = lerCriterios()
  const sempre = c.cenarios.filter(x => x.quando === 'sempre').map(x => x.id)
  expect(sempre).toEqual(expect.arrayContaining(['m-acerto', 'm-erro', 'm-entrada', 'm-saida']))
  expect(c.cenarios.map(x => x.id)).toContain('m-borda')
})

test('REGRESSAO criterio ausente LANCA — cair para "sem criterio" faria o gate voltar a julgar por impressao', () => {
  comCriterios(null, () => {
    expect(() => lerCriterios()).toThrow('nao encontrado')
  })
})

test('REGRESSAO lista vazia de criterio e recusada', () => {
  comCriterios(JSON.stringify({ versao: 1, criterios: [] }), () => {
    expect(() => lerCriterios()).toThrow('sem criterio nenhum')
  })
})

test('criterio sem id ou sem "checa" e recusado', () => {
  comCriterios(JSON.stringify({ criterios: [{ titulo: 'x' }] }), () => {
    expect(() => lerCriterios()).toThrow('sem id ou sem')
  })
})

test('arquivo ilegivel lanca dizendo que e ilegivel', () => {
  comCriterios('{{{', () => expect(() => lerCriterios()).toThrow('ilegivel'))
})

test('o texto renderizado leva id, versao e a ordem de citar o id ao reprovar', () => {
  const texto = renderizarCriterios()
  expect(texto).toContain('config/review-criteria.json v')
  expect(texto).toContain('[c-erro]')
  expect(texto).toContain('MATRIZ DE CENARIO')
  expect(texto).toContain('cite o id do criterio violado')
})

test('INVARIANTE o gate usa o criterio versionado — nao os padroes hardcoded de antes', async () => {
  const fonte = await Bun.file('motor/cic/crv/gate.ts').text()
  expect(fonte).toContain('renderizarCriterios()')
  expect(fonte, 'a string de padroes voltou para dentro do prompt').not.toContain('PADROES: tudo tipado strict')
  expect(fonte, 'o veredicto precisa carregar qual criterio foi violado').toContain('"criterio"')
})

test('arquivoDeCriterios respeita a variavel de ambiente do contrato', () => {
  comCriterios('{"criterios":[{"id":"a","titulo":"t","checa":"c"}]}', () => {
    expect(arquivoDeCriterios()).toContain('crit.json')
    expect(lerCriterios().criterios[0]?.id).toBe('a')
  })
})
