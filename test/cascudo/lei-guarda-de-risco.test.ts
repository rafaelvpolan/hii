import { test, expect, afterAll, lerArquivo } from '../apoio/runner.ts'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { avaliarDiff, casaPadrao, lerRegras, regrasQueBatem } from '../../motor/cascudo/lei/guarda.ts'
import { aplicarLei, planSteps } from '../../motor/oswaldo/rota/perfil.ts'
import { activeSteps } from '../../motor/niemeyer/config.ts'
import type { RegraInegociavel } from '../../motor/cascudo/lei/guarda.ts'

const criados: string[] = []
afterAll(() => { for (const d of criados) rmSync(d, { recursive: true, force: true }) })

function comRegras<T>(conteudo: string, corpo: () => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'hii-lei-'))
  criados.push(dir)
  const arquivo = join(dir, 'regras.json')
  writeFileSync(arquivo, conteudo)
  const anterior = process.env.HICODE_REGRAS_FILE
  process.env.HICODE_REGRAS_FILE = arquivo
  try { return corpo() } finally {
    if (anterior === undefined) delete process.env.HICODE_REGRAS_FILE
    else process.env.HICODE_REGRAS_FILE = anterior
  }
}

const REGRA: RegraInegociavel = {
  id: 'r-0001',
  categoria: 'seguranca',
  descricao: 'Diff tocando Payment* exige teste de idempotencia',
  gatilho: { arquivos: ['app/Http/Controllers/Payment*'] },
  exigencia: 'teste_integracao_idempotencia',
  origem: { cards: ['041', '058', '073'], promovidoEm: '2026-09-01', promovidoPor: 'rafael' },
}

test('diff em migrations/ forca completo mesmo com o card dizendo risk: low', () => {
  const v = avaliarDiff(['database/migrations/2026_01_01_cria.php'], [])
  expect(v.forca).toBe('completo')
  expect(v.motivos.join(' ')).toContain('migrations')
})

test('as areas de rigor obrigatorio valem com o arquivo de regras VAZIO', () => {
  for (const a of ['app/Auth/Login.php', 'src/payment/checkout.ts', '.env', 'infra/secrets/prod.yaml', 'certs/chave.pem']) {
    expect(avaliarDiff([a], []).forca, `${a} deveria elevar o rigor`).toBe('completo')
  }
})

test('diff inofensivo nao eleva nada — a guarda nao opina sem motivo', () => {
  const v = avaliarDiff(['README.md', 'src/ui/Botao.tsx'], [])
  expect(v.forca).toBeNull()
  expect(v.motivos).toEqual([])
})

test('regra do arquivo bate por glob e entra no motivo com id e exigencia', () => {
  const v = avaliarDiff(['app/Http/Controllers/PaymentController.php'], [REGRA])
  expect(v.regras.map(r => r.id)).toEqual(['r-0001'])
  expect(v.motivos.join(' ')).toContain('r-0001')
  expect(v.motivos.join(' ')).toContain('teste_integracao_idempotencia')
})

test('glob: * fica dentro do segmento, ** atravessa', () => {
  expect(casaPadrao('app/*.php', 'app/X.php')).toBe(true)
  expect(casaPadrao('app/*.php', 'app/sub/X.php')).toBe(false)
  expect(casaPadrao('app/**/X.php', 'app/a/b/X.php')).toBe(true)
  expect(casaPadrao('app/**/X.php', 'app/X.php')).toBe(true)
  expect(casaPadrao('Payment*', 'PaymentController.php')).toBe(true)
})

test('REGRESSAO arquivo de regras ilegivel LANCA — nao vira "nenhuma regra"', () => {
  comRegras('{ isto nao e json', () => {
    expect(() => lerRegras(), 'erro de digitacao viraria bypass de todas as regras de uma vez').toThrow('ilegivel')
  })
})

test('REGRESSAO regra sem id ou sem exigencia e recusada na leitura', () => {
  comRegras(JSON.stringify({ regras: [{ categoria: 'x', gatilho: {} }] }), () => {
    expect(() => lerRegras()).toThrow('sem id ou exigencia')
  })
})

test('arquivo ausente e lista vazia — ausencia nao e erro, so nao ha regra promovida', () => {
  comRegras('{"versao":1,"regras":[]}', () => expect(lerRegras()).toEqual([]))
})

test('regrasQueBatem so devolve o que casa, e nada quando o diff e vazio', () => {
  expect(regrasQueBatem([], [REGRA])).toEqual([])
  expect(regrasQueBatem(['src/outro.ts'], [REGRA])).toEqual([])
  expect(regrasQueBatem(['app/Http/Controllers/PaymentRefund.php'], [REGRA]).length).toBe(1)
})

test('INVARIANTE a LEI so SOBE o rigor — nenhum passo que ia rodar deixa de rodar', () => {
  const todos = activeSteps()
  const perfis = [
    { title: 'ajustar texto do botao', objetivo: 'trocar copy', risk: 'low', surface: 'visual' },
    { title: 'corrigir calculo', objetivo: 'bug na comissao', risk: 'low' },
    { title: 'bump de dependencia', objetivo: 'subir versao', risk: 'low' },
    { title: 'refatorar servico', objetivo: 'logica', risk: 'high' },
  ]
  for (const t of perfis) {
    const antes = planSteps(t, todos)
    const depois = aplicarLei(antes, { forca: 'completo', motivos: ['x'], regras: [] }, todos)
    const idsAntes = antes.steps.map(s => s.id)
    const idsDepois = new Set(depois.steps.map(s => s.id))
    for (const id of idsAntes) {
      expect(idsDepois.has(id), `"${t.title}": a LEI removeu o passo ${id}`).toBe(true)
    }
    expect(depois.steps.length).toBeGreaterThanOrEqual(antes.steps.length)
    expect(depois.profile).toBe('completo')
  }
})

test('INVARIANTE sem motivo, a LEI devolve o plano intacto — nao mexe no que nao precisa', () => {
  const todos = activeSteps()
  const antes = planSteps({ title: 'trocar copy', objetivo: 'texto', risk: 'low', surface: 'visual' }, todos)
  const depois = aplicarLei(antes, { forca: null, motivos: [], regras: [] }, todos)
  expect(depois).toBe(antes)
})

// A versao anterior era wiring por texto e ORDEM: passar `{ forca: null, motivos:
// [], regras: [] }` — ou seja, DESCARTAR a LEI calculada — mantinha as tres
// assercoes verdes, porque elas so provavam que os identificadores existem no
// arquivo. Agora o COMPORTAMENTO e exercitado, e o texto so confere que o
// resultado de avaliarDiff e o que chega em aplicarLei.
test('COMPORTAMENTO a LEI eleva o rigor quando o diff pede, e nao quando nao pede', () => {
  const todos = activeSteps()
  const cosmetico = { title: 'ajustar texto do botao', objetivo: 'trocar copy', risk: 'low', surface: 'visual' }
  const semLei = planSteps(cosmetico, todos)
  const lei = avaliarDiff(['database/migrations/2026_01_01_cria.php'], [])
  expect(lei.forca, 'migrations forca completo').toBe('completo')
  const comLei = aplicarLei(planSteps(cosmetico, todos), lei, todos)
  expect(comLei.steps.length, 'a LEI tem de ACRESCENTAR passo ao plano cosmetico').toBeGreaterThan(semLei.steps.length)
  const semForca = aplicarLei(planSteps(cosmetico, todos), { forca: null, motivos: [], regras: [] }, todos)
  expect(semForca.steps.length, 'sem forca a LEI nao muda nada').toBe(semLei.steps.length)
})

test('INVARIANTE o motor consulta a LEI no fechamento e USA o resultado — nao descarta', async () => {
  const fonte = await lerArquivo('motor/quilombo/cartorio/fechar.ts')
  const iAvaliar = fonte.indexOf('avaliarDiff(changed)')
  const iAplicar = fonte.indexOf('aplicarLei(')
  const iPassos = fonte.indexOf('const steps = plan.steps')
  for (const [nome, i] of [['avaliarDiff(changed)', iAvaliar], ['aplicarLei(', iAplicar], ['const steps = plan.steps', iPassos]] as const) {
    expect(i, `${nome} sumiu de fechar.ts`).toBeGreaterThan(-1)
  }
  expect(iAvaliar < iAplicar, 'a LEI tem de ser avaliada antes de aplicada').toBe(true)
  expect(iAplicar < iPassos, 'a LEI tem de decidir ANTES dos passos serem usados').toBe(true)
  // E o resultado tem de CHEGAR em aplicarLei: `aplicarLei(plan, lei, all)`, nao um
  // literal descartando o que avaliarDiff devolveu.
  const chamada = fonte.slice(iAplicar, iAplicar + 400)
  expect(/(^|[^A-Za-z])lei([^A-Za-z]|$)/.test(chamada), 'aplicarLei recebendo literal em vez da LEI calculada e descarte disfarcado de wiring').toBe(true)
})

// `origem` estava no arquivo em disco, no plano mestre, e em NENHUM tipo nem
// validacao: regra nova entrava sem dizer quem decidiu nem quando, e o criterio
// que justifica a existencia da LEI ("nunca de um caso isolado") era um paragrafo
// de documento sem guarda.
test('regra SEM origem e recusada, nomeando a regra', () => {
  const semOrigem = { id: 'r-9001', categoria: 'x', descricao: 'y', gatilho: {}, exigencia: 'z' }
  comRegras(JSON.stringify({ versao: 1, regras: [semOrigem] }), () => {
    expect(() => lerRegras()).toThrow('r-9001')
  })
})

test('origem sem quem promoveu, ou com data invalida, e recusada', () => {
  const base = { id: 'r-9002', categoria: 'x', descricao: 'y', gatilho: {}, exigencia: 'z' }
  comRegras(JSON.stringify({ versao: 1, regras: [{ ...base, origem: { cards: [], promovidoEm: '2026-01-01', promovidoPor: '' } }] }), () => {
    expect(() => lerRegras()).toThrow('promovidoPor')
  })
  comRegras(JSON.stringify({ versao: 1, regras: [{ ...base, origem: { cards: [], promovidoEm: 'setembro', promovidoPor: 'rafael' } }] }), () => {
    expect(() => lerRegras()).toThrow('promovidoEm')
  })
  comRegras(JSON.stringify({ versao: 1, regras: [{ ...base, origem: { cards: 'nao-e-lista', promovidoEm: '2026-01-01', promovidoPor: 'rafael' } }] }), () => {
    expect(() => lerRegras()).toThrow('origem.cards')
  })
})

test('cards VAZIO continua valendo — ha regra que nasce de decisao de projeto, nao de recorrencia', () => {
  const daProjeto = { id: 'r-9003', categoria: 'infra', descricao: 'y', gatilho: {}, exigencia: 'z', origem: { cards: [], promovidoEm: '2026-08-23', promovidoPor: 'rafael' } }
  comRegras(JSON.stringify({ versao: 1, regras: [daProjeto] }), () => {
    expect(lerRegras().map(r => r.id)).toEqual(['r-9003'])
  })
})

test('o arquivo de regras DESTE repo passa pela propria validacao de procedencia', () => {
  const regras = lerRegras()
  // `[].every(...)` e true: sem esta guarda, o arquivo ficar sem regra nenhuma
  // fazia a assercao passar sem verificar nada.
  expect(regras.length, 'nenhuma regra carregada: a assercao abaixo seria vacua').toBeGreaterThan(0)
  for (const r of regras) {
    expect(r.origem.promovidoPor.trim().length, `${r.id} sem quem promoveu`).toBeGreaterThan(0)
    expect(r.origem.promovidoEm, `${r.id} sem data`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(Array.isArray(r.origem.cards), `${r.id}: origem.cards nao e lista`).toBe(true)
  }
})
