import { test, expect } from '../apoio/runner.ts'

const A = await import('../../motor/cascudo/acervo.ts')
const CND = await import('../../motor/ciclo/canudos/gauntlet.ts')

const ACERVO = A.carregarAcervo()
const DO_PACK = ACERVO.filter(s => s.pack === 'frontend-web')

const CTX_VUE = { arquivos: ['src/components/Botao.vue'], deps: ['vue'] }
const CTX_BACKEND = { arquivos: ['app/Http/Controllers/PedidoController.php'], deps: ['laravel'] }

test('o pack frontend-web existe e traz as tres skills que o plano nomeia', () => {
  expect(DO_PACK.map(s => s.id).sort()).toEqual(['accessibility-a11y', 'frontend-patterns', 'seo-technical'])
})

test('toda skill do pack carrega — frontmatter valido e corpo de instrucao presente', () => {
  for (const s of DO_PACK) {
    expect(s.papeis.length, `${s.id} sem papel`).toBeGreaterThan(0)
    expect(s.instrucoes.length, `${s.id} sem corpo`).toBeGreaterThan(200)
  }
})

test('o gatilho dispara em arquivo de front e NAO em arquivo de backend', () => {
  for (const papel of ['implementador', 'avaliador'] as const) {
    const noFront = A.skillsPara(papel, CTX_VUE, ACERVO).filter(s => s.pack === 'frontend-web')
    expect(noFront.length, `${papel} deveria receber skill de front num .vue`).toBeGreaterThan(0)
  }
  const noBackend = A.skillsPara('implementador', CTX_BACKEND, ACERVO).filter(s => s.pack === 'frontend-web')
  expect(noBackend, 'skill de front num controller PHP e ruido caro').toEqual([])
})

test('o pack habilita o modo gauntlet do crivo — era o bloqueio do item 23', () => {
  const packs = [...new Set(A.skillsPara('avaliador', CTX_VUE, ACERVO).map(s => s.pack))]
  expect(packs).toContain('frontend-web')
  expect(CND.gauntletVale(packs).vale, 'sem pack com referencia de mercado o gauntlet nunca ligava').toBe(true)
})

test('backend continua fora do gauntlet — nao existe screenshot de "comissao calculada certo"', () => {
  const packs = [...new Set(A.skillsPara('avaliador', CTX_BACKEND, ACERVO).map(s => s.pack))]
  expect(CND.gauntletVale(packs).vale).toBe(false)
})

test('item 15: cada skill do pack cita referencia datada de 2026, nao conselho atemporal', () => {
  for (const s of DO_PACK) {
    expect(s.instrucoes, `${s.id} sem nota de referencia datada`).toMatch(/202[4-6]/)
  }
})

test('Core Web Vitals entram como NUMERO no seo-technical — "parece rapido" nao e gate', () => {
  const seo = DO_PACK.find(s => s.id === 'seo-technical')
  expect(seo?.instrucoes).toContain('INP')
  expect(seo?.instrucoes).toContain('200')
  expect(seo?.instrucoes).toContain('2,5')
  expect(seo?.instrucoes).toContain('0,1')
})

test('o pack respeita o c-vue do crivo: Vue e o default, React so quando o alvo e React', () => {
  const patterns = DO_PACK.find(s => s.id === 'frontend-patterns')
  const i = patterns?.instrucoes ?? ''
  expect(i).toContain('Vue 3')
  expect(i.indexOf('Vue 3'), 'React antes de Vue inverteria o default do repo').toBeLessThan(i.indexOf('React'))
})

test('a auditoria do harness aprova o pack novo — skill que nao passa nao carrega', async () => {
  const { auditarTexto } = await import('../../motor/agentes/vital/auditoria-harness.ts')
  const achados = DO_PACK.flatMap(s => auditarTexto(s.instrucoes, s.arquivo))
  expect(achados).toEqual([])
})
