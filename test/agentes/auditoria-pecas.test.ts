import { test, expect, lerArquivo } from '../apoio/runner.ts'
import { coberturaDeTeste, coberturaFecha, selecionarAuditoria } from '../../motor/agentes/ass/auditoria.ts'
// Importa os MODULOS, e nao so a fachada. A cobertura do proprio auditor e medida
// por import (`coberturaDeTeste`), entao um teste que le apenas o reexport deixa
// as pecas reais aparecendo como "sem teste correspondente" — o auditor acusando
// a si mesmo por um defeito que e do teste, nao do codigo.
import { MAX_LINHAS, GOD_FUNCS, GOD_EXPORTS, LABEL_FORA, RANK_GRAVIDADE, orcamentoValido, tetoDeLotes } from '../../motor/agentes/ass/tipos.ts'
import { ehArquivoDeTeste, extensaoDe, stemDe } from '../../motor/agentes/ass/cobertura.ts'
import { metricasDe, rejeitarPorCaminho } from '../../motor/agentes/ass/metricas.ts'
import { ordenarPorRisco } from '../../motor/agentes/ass/plano.ts'
import { coberturaFecha as coberturaFechaDoRelato } from '../../motor/agentes/ass/relato.ts'

// A divisao de auditoria.ts (402 linhas, quatro assuntos num arquivo) foi feita
// porque o auditor reprova arquivo nesse formato — ferramenta que se isenta do
// proprio criterio nao vale como criterio. Estes testes prendem as pecas.

test('a fachada e as pecas devolvem a MESMA funcao — o reexport nao pode divergir', () => {
  expect(coberturaFecha).toBe(coberturaFechaDoRelato)
})

test('os limiares sao dados nomeados, nao numeros soltos no meio da medicao', () => {
  expect(MAX_LINHAS).toBe(350)
  expect(GOD_FUNCS).toBe(20)
  expect(GOD_EXPORTS).toBe(3)
  expect(Object.keys(LABEL_FORA).length, 'todo motivo de exclusao precisa de rotulo legivel').toBe(6)
  expect(RANK_GRAVIDADE.alta).toBeLessThan(RANK_GRAVIDADE.media)
})

test('orcamento invalido cai no fallback em vez de virar lote de zero caractere', () => {
  expect(orcamentoValido(0, 60000)).toBe(60000)
  expect(orcamentoValido(-5, 60000)).toBe(60000)
  expect(orcamentoValido(Number.NaN, 60000)).toBe(60000)
  expect(orcamentoValido(1234, 60000)).toBe(1234)
  expect(tetoDeLotes(0), 'zero significa "sem teto", nao "nenhum lote"').toBe(0)
  expect(tetoDeLotes(-3)).toBe(0)
  expect(tetoDeLotes(4)).toBe(4)
})

test('cobertura: extensao, stem e reconhecimento de teste', () => {
  expect(extensaoDe('a/b/c.test.ts')).toBe('ts')
  expect(extensaoDe('Dockerfile')).toBe('')
  expect(stemDe('motor/x/board.test.ts')).toBe('board')
  expect(ehArquivoDeTeste('test/mir/board.test.ts')).toBe(true)
  expect(ehArquivoDeTeste('motor/mir/render/board.ts')).toBe(false)
  expect(ehArquivoDeTeste('app/tests/servico_test.py')).toBe(true)
})

test('metricas: monolito, god-file e a diretiva de divida assumida', () => {
  const cobertura = coberturaDeTeste([], () => null)
  const grande = metricasDe('a.ts', 'export const x = 1\n'.repeat(400), cobertura)
  expect(grande.excedeLinhas).toBe(true)
  expect(grande.motivos.join(' ')).toContain('monolito')

  const sancionado = metricasDe('b.ts', '// hicode:allow-monolith\n' + 'const y = 1\n'.repeat(400), cobertura)
  expect(sancionado.excedeLinhas, 'a diretiva nao apaga o fato').toBe(true)
  expect(sancionado.motivos.join(' ')).toContain('divida assumida')
  expect(sancionado.risco, 'divida assumida nao soma peso de monolito').toBeLessThan(grande.risco)
})

test('rejeitarPorCaminho nomeia o motivo em vez de sumir com o arquivo', () => {
  expect(rejeitarPorCaminho('node_modules/x/i.js')?.motivo).toBe('diretorio-gerado')
  expect(rejeitarPorCaminho('tipos.d.ts')?.motivo).toBe('extensao-nao-auditavel')
  expect(rejeitarPorCaminho('README.md')?.motivo).toBe('extensao-nao-auditavel')
  expect(rejeitarPorCaminho('motor/x.ts'), 'codigo auditavel nao e rejeitado').toBeNull()
})

test('ordenarPorRisco poe o risco maior primeiro, e desempata estavel', () => {
  const base = { chars: 10, linhas: 1, funcoes: 1, exports: 1, excedeLinhas: false, godFile: false, semTeste: false, motivos: [] }
  const ordenado = ordenarPorRisco([
    { ...base, path: 'b.ts', risco: 5 },
    { ...base, path: 'a.ts', risco: 40 },
    { ...base, path: 'c.ts', risco: 5 },
  ])
  expect(ordenado.map(a => a.path)).toEqual(['a.ts', 'b.ts', 'c.ts'])
})

test('o proprio auditor passa no criterio dele: nenhuma peca de ass/ e monolito nem god-file', async () => {
  const { readdirSync, readFileSync: ler } = await import('node:fs')
  const cobertura = coberturaDeTeste([], () => null)
  const pecas = readdirSync('motor/agentes/ass').filter(n => n.endsWith('.ts'))
  expect(pecas.length, 'a divisao tem de ter deixado mais de um arquivo').toBeGreaterThan(4)
  for (const nome of pecas) {
    const m = metricasDe(`motor/agentes/ass/${nome}`, ler(`motor/agentes/ass/${nome}`, 'utf8'), cobertura)
    expect(m.excedeLinhas, `${nome} voltou a ser monolito`).toBe(false)
    expect(m.godFile, `${nome} virou god-file`).toBe(false)
  }
})

// `apenas` existe para auditar a superficie de uma BRANCH: um diff espalha por
// dezenas de diretorios e nao tem prefixo comum, entao `escopo` (prefixo cru) nao
// serve. A trava que importa: recorte nao pode alterar a cobertura de teste.
test('apenas recorta por lista exata de caminhos', async () => {
  const arquivos = {
    'a.ts': 'export const a = 1\n',
    'b.ts': 'export const b = 1\n',
    'c.ts': 'export const c = 1\n',
  }
  const p = await selecionarAuditoria({
    listar: async () => Object.keys(arquivos),
    ler: (x: string) => (arquivos as Record<string, string>)[x] ?? null,
    apenas: ['a.ts', 'c.ts'],
  })
  expect(p.lotes.flatMap(l => l.arquivos).map(a => a.path).sort()).toEqual(['a.ts', 'c.ts'])
  expect(p.totalListado, 'o total tem de ser o do recorte, senao a cobertura nao fecha').toBe(2)
  expect(coberturaFecha(p)).toBe(true)
})

test('apenas vazio nao recorta nada — lista vazia significa "sem recorte", nao "nenhum arquivo"', async () => {
  const arquivos = { 'a.ts': 'export const a = 1\n', 'b.ts': 'export const b = 1\n' }
  const p = await selecionarAuditoria({
    listar: async () => Object.keys(arquivos),
    ler: (x: string) => (arquivos as Record<string, string>)[x] ?? null,
    apenas: [],
  })
  expect(p.totalAuditado).toBe(2)
})

test('apenas NAO estraga a cobertura de teste — o teste fora do recorte continua contando', async () => {
  const arquivos = {
    'motor/x.ts': 'export const x = 1\n',
    'test/x.test.ts': "import { x } from '../motor/x.ts'\n",
  }
  const p = await selecionarAuditoria({
    listar: async () => Object.keys(arquivos),
    ler: (k: string) => (arquivos as Record<string, string>)[k] ?? null,
    apenas: ['motor/x.ts'],
  })
  const alvo = p.lotes.flatMap(l => l.arquivos).find(a => a.path === 'motor/x.ts')
  expect(alvo?.semTeste, 'o teste ficou fora do recorte, mas EXISTE — acusar "sem teste" seria falso').toBe(false)
})

test('apenas e escopo compoem: o recorte por lista vale DENTRO do prefixo', async () => {
  const arquivos = { 'motor/a.ts': 'export const a = 1\n', 'bin/a.ts': 'export const a = 1\n' }
  const p = await selecionarAuditoria({
    listar: async () => Object.keys(arquivos),
    ler: (k: string) => (arquivos as Record<string, string>)[k] ?? null,
    escopo: 'motor/',
    apenas: ['motor/a.ts', 'bin/a.ts'],
  })
  expect(p.lotes.flatMap(l => l.arquivos).map(a => a.path)).toEqual(['motor/a.ts'])
})

// `apenas` existia sem consumidor de producao: o proposito declarado ("auditar a
// superficie de uma BRANCH") era inalcancavel, porque nada montava a lista a
// partir de um diff. O consumidor e o skill /verificar, com --branch.
// A versao anterior deste invariante era um grep no SKILL.md — ou seja, afirmava
// sobre DOCUMENTACAO, e nao conseguia detectar que `apenas` continuava sem
// chamador de CODIGO. Agora exige o chamador de verdade.
test('INVARIANTE `apenas` tem chamador de CODIGO, nao so prosa num documento', async () => {
  const script = await lerArquivo('scripts/auditar.ts')
  expect(script, 'o recorte por lista exata precisa de um consumidor executavel').toContain('apenas:')
  expect(script).toContain('arquivosDaBranch(')
  const skill = await lerArquivo('.claude/skills/verificar/SKILL.md')
  expect(skill, 'o skill tem de CHAMAR o script, nao reimplementar a selecao inline').toContain('scripts/auditar.ts')
  expect(skill).toContain('--branch')
  expect(skill, 'o recorte tem de avisar que a cobertura vale so para ele').toContain('superficie DESTA branch')
})
