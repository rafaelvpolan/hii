import { test, expect, afterAll, lerArquivo } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-cadeia-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(join(process.env.HICODE_CARDS_DIR, 'runs'), { recursive: true })
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const CND = await import('../../motor/ciclo/canudos/gauntlet.ts')
const A = await import('../../motor/cascudo/acervo.ts')
const { anexarNaSessao, migrarRefsDaSessao } = await import('../../motor/quilombo/alfandega/anexo.ts')
const { refsDir } = await import('../../motor/euclides/estado-em-disco.ts')

const ACERVO = A.carregarAcervo()
const PNG = Buffer.from('89504e470d0a1a0a', 'hex')

function anexarLocalNaSessao(sessao: string, nome: string): string {
  const origem = join(BASE, nome)
  writeFileSync(origem, PNG)
  const r = anexarNaSessao(sessao, origem)
  expect(r.ok, `anexo recusado: ${r.motivo}`).toBe(true)
  return origem
}

function comTelaRenderizada(card: string): string {
  const tela = CND.telaDoCard(card)
  mkdirSync(join(tela, '..'), { recursive: true })
  writeFileSync(tela, PNG)
  return tela
}

test('ELO 1 a referencia anexada na conversa migra para a pasta do CARD', () => {
  anexarLocalNaSessao('sessao-a', 'mockup.png')
  const m = migrarRefsDaSessao('sessao-a', '101')
  expect(m.migrados, 'sem migracao a referencia fica presa na conversa e o card nunca a ve').toBe(1)
  expect(existsSync(refsDir('101'))).toBe(true)
  expect(CND.referenciasDoCard('101').length).toBe(1)
})

test('ELO 2 o pack frontend-web satisfaz o gatilho de dominio para um diff de .vue', () => {
  const packs = [...new Set(A.skillsPara('avaliador', { arquivos: ['src/Home.vue'], deps: ['vue'] }, ACERVO).map(s => s.pack))]
  expect(CND.gauntletVale(packs).vale).toBe(true)
})

test('ELO 3 com o gauntlet LIGADO, referencia no card e dominio de front, o modo escolhido e gauntlet', () => {
  const packs = [...new Set(A.skillsPara('avaliador', { arquivos: ['src/Home.vue'], deps: ['vue'] }, ACERVO).map(s => s.pack))]
  const m = CND.modoDoCrivo({ packs, referencias: CND.referenciasDoCard('101'), ativado: true })
  expect(m.modo).toBe('gauntlet')
})

test('ELO 4 a comparacao cega entrega os dois caminhos e NAO diz qual e o do motor', () => {
  const tela = comTelaRenderizada('101')
  const referencias = CND.referenciasDoCard('101')
  const candidatos = [
    { origem: 'motor', conteudo: `abra a imagem com a tool Read: ${tela}` },
    ...referencias.map(r => ({ origem: 'referencia', conteudo: `abra a imagem com a tool Read: ${r}` })),
  ]
  const cega = CND.cegar(candidatos, '101')
  const texto = CND.renderizarComparacao(cega)
  expect(texto).toContain(tela)
  for (const r of referencias) expect(texto).toContain(r)
  // `not.toContain('referencia:')` era string que o codigo nao tem forma de
  // produzir. O vazamento real e QUALQUER valor do mapa rotulo->origem aparecer no
  // texto entregue ao critico, e e isso que se verifica agora — genericamente,
  // sem depender de como a origem seria escrita.
  const origens = Object.values(cega.deRotulo)
  expect(origens.length, 'sem origens nao ha vazamento possivel — o teste seria vacuo').toBeGreaterThan(1)
  for (const origem of origens) {
    expect(texto.toLowerCase(), `a origem "${origem}" vazou para o texto: saber qual e o proprio trabalho transforma critica em autoavaliacao`)
      .not.toContain(origem.toLowerCase())
  }
})

test('CADEIA QUEBRA no elo certo: sem tela renderizada, o card cai no criterio escrito', () => {
  anexarLocalNaSessao('sessao-b', 'outro.png')
  migrarRefsDaSessao('sessao-b', '102')
  expect(CND.referenciasDoCard('102').length).toBe(1)
  expect(existsSync(CND.telaDoCard('102')), 'card sem fase de url nao tem tela').toBe(false)
  // A decisao de dominio CONTINUA dizendo gauntlet — dominio e referencia estao
  // la. Quem barra e o gate, por falta de tela, e o motivo vai para o card. Isto
  // separa os dois elos em vez de confundi-los num veredicto so.
  const packs = [...new Set(A.skillsPara('avaliador', { arquivos: ['src/Home.vue'], deps: ['vue'] }, ACERVO).map(s => s.pack))]
  expect(CND.modoDoCrivo({ packs, referencias: CND.referenciasDoCard('102'), ativado: true }).modo).toBe('gauntlet')
})

test('CADEIA QUEBRA no elo certo: card SEM referencia nao entra em gauntlet mesmo sendo front', () => {
  const packs = [...new Set(A.skillsPara('avaliador', { arquivos: ['src/Home.vue'], deps: ['vue'] }, ACERVO).map(s => s.pack))]
  const m = CND.modoDoCrivo({ packs, referencias: CND.referenciasDoCard('999-sem-ref'), ativado: true })
  expect(m.modo).toBe('criterio-escrito')
  expect(m.motivo).toContain('referencia')
})

test('INVARIANTE o gate exige tela E provedor com visao antes de entrar em gauntlet', async () => {
  const fonte = await lerArquivo('motor/ciclo/crivo/gate.ts')
  expect(fonte).toContain('provider.supportsVision && existsSync(tela)')
  expect(fonte, 'faltando qualquer elo, o motivo tem de ir para o card em vez de cair calado').toContain('crivo_modo')
})

test('ELO 0 o interruptor: a cadeia inteira montada, mas o gauntlet desligado, cai no criterio escrito', () => {
  const packs = [...new Set(A.skillsPara('avaliador', { arquivos: ['src/Home.vue'], deps: ['vue'] }, ACERVO).map(s => s.pack))]
  expect(CND.referenciasDoCard('101').length).toBe(1)
  expect(CND.gauntletVale(packs).vale).toBe(true)
  expect(CND.modoDoCrivo({ packs, referencias: CND.referenciasDoCard('101') }).modo).toBe('criterio-escrito')
})

test('INVARIANTE o gate LE o interruptor e o gasto do card — nao decide o modo por heuristica sozinho', async () => {
  const fonte = await lerArquivo('motor/ciclo/crivo/gate.ts')
  expect(fonte).toContain('ativado: gauntletLigado()')
  expect(fonte, 'sem gasto o teto de podeIniciar() volta a ser decorativo').toContain('gastoUsd:')
})
