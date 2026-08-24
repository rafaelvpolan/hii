import { test, expect, afterAll } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { avaliarDiff, casaPadrao, lerRegras, regrasQueBatem } from '../../motor/csd/lei/guarda.ts'
import { aplicarLei, planSteps } from '../../motor/osw/rta/perfil.ts'
import { activeSteps } from '../../motor/nmy/config.ts'
import type { RegraInegociavel } from '../../motor/csd/lei/guarda.ts'

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

test('INVARIANTE o motor consulta a LEI no fechamento — senao a guarda e enfeite', async () => {
  const fonte = await Bun.file('motor/qlb/ctr/fechar.ts').text()
  expect(fonte).toContain('avaliarDiff(changed)')
  expect(fonte).toContain('aplicarLei(')
  const ordem = fonte.indexOf('avaliarDiff(changed)') < fonte.indexOf('const steps = plan.steps')
  expect(ordem, 'a LEI tem de decidir ANTES dos passos serem usados').toBe(true)
})
