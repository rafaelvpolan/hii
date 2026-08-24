import { test, expect } from 'bun:test'
import { aplicarLei, planSteps, valeDivergir } from '../../motor/osw/rta/perfil.ts'
import type { TaskInput } from '../../motor/osw/rta/perfil.ts'
import { DEFAULT_STEPS } from '../../motor/nmy/config.ts'

function ids(task: TaskInput): string[] {
  return planSteps(task, DEFAULT_STEPS).steps.map(s => s.id)
}

test('trocar um texto -> enxuto: pula seguranca, arquitetura e testes', () => {
  const p = planSteps({ title: 'trocar o texto do botao apoiar', risk: 'low' }, DEFAULT_STEPS)
  expect(p.profile).toBe('enxuto')
  expect(p.steps.map(s => s.id)).not.toContain('seguranca')
  expect(p.steps.map(s => s.id)).not.toContain('arquitetura')
  expect(p.steps.map(s => s.id)).not.toContain('testes')
})

test('typo/ortografia -> enxuto', () => {
  expect(planSteps({ title: 'corrige o typo no rodape', risk: 'low' }, DEFAULT_STEPS).profile).toBe('enxuto')
})

test('login/senha/jwt -> mantem seguranca e testes', () => {
  const i = ids({ title: 'adiciona login com senha e jwt', risk: 'low' })
  expect(i).toContain('seguranca')
  expect(i).toContain('testes')
})

test('novo endpoint na api -> mantem seguranca e testes', () => {
  const i = ids({ title: 'cria endpoint de cadastro na api', risk: 'low' })
  expect(i).toContain('seguranca')
  expect(i).toContain('testes')
})

test('mudanca so visual (surface=visual) -> pula seguranca', () => {
  const i = ids({ title: 'muda a cor do hero', surface: 'visual', risk: 'low' })
  expect(i).not.toContain('seguranca')
  expect(i).not.toContain('testes')
})

test('bump de dependencias -> deps: testes + seguranca(CVE), sem arquitetura', () => {
  const p = planSteps({ title: 'atualiza o pacote vitest e o lockfile', risk: 'low' }, DEFAULT_STEPS)
  expect(p.profile).toBe('deps')
  expect(p.steps.map(s => s.id)).toContain('testes')
  expect(p.steps.map(s => s.id)).toContain('seguranca')
  expect(p.steps.map(s => s.id)).not.toContain('arquitetura')
})

test('risco alto -> completo, roda todos os passos', () => {
  const p = planSteps({ title: 'trocar um texto', risk: 'high' }, DEFAULT_STEPS)
  expect(p.profile).toBe('completo')
  expect(p.steps.length).toBe(DEFAULT_STEPS.length)
})

test('ambiguo (sem sinais) -> mantem seguranca por seguranca', () => {
  const i = ids({ title: 'melhora o apoiar', risk: 'low' })
  expect(i).toContain('seguranca')
  expect(i).toContain('limpeza')
})

test('override "all" no card forca todos os passos', () => {
  const p = planSteps({ title: 'trocar um texto', risk: 'low', override: 'all' }, DEFAULT_STEPS)
  expect(p.steps.length).toBe(DEFAULT_STEPS.length)
})

test('override lista roda exatamente os ids informados', () => {
  const p = planSteps({ title: 'trocar um texto', risk: 'low', override: 'testes,seguranca' }, DEFAULT_STEPS)
  expect(p.steps.map(s => s.id).sort()).toEqual(['seguranca', 'testes'])
})

test('migration/schema -> mantem seguranca e testes', () => {
  const i = ids({ title: 'adiciona migration com nova coluna no schema', risk: 'low' })
  expect(i).toContain('seguranca')
  expect(i).toContain('testes')
})

// O pedido real que motivou tudo caia em `padrao` (Arquitetura + Testes +
// Limpeza) porque `integr\w*` casa "integrar" — palavra que ali era CONTEXTO do
// pedido, nao o pedido. E nao havia UMA palavra de cor/css/layout em nenhuma lista.
const PROMPT_REAL = 'faça uma analise de cores do podium top 3, veja se as cores estão de acordo com o padrão barbeiro-frontend/ esta sendo feito/executado em ui-lab/leaderboard-barbeiro.html, objetivo ao integrar o ranking no barbeiro deve combinar as cores.'

test('mudanca de aparencia vai pelo caminho RAPIDO: nenhum passo de pipeline', () => {
  const p = planSteps({ title: 'analise de cores do podium', objetivo: PROMPT_REAL, risk: 'low' }, DEFAULT_STEPS)
  expect(p.profile).toBe('visual')
  expect(p.steps, 'o que revisa e o crivo do fecho, que le o diff — uma chamada, nao quatro').toEqual([])
  expect(p.skipped.sort()).toEqual(['Arquitetura', 'Limpeza', 'Seguranca', 'Testes'])
  expect(p.reason).toContain('aparencia')
})

test('vocabulario de estilo cobre cor, css, layout e tipografia', () => {
  for (const objetivo of [
    'trocar a cor do botao', 'ajustar o padding do card', 'arrumar o css do header',
    'mudar a fonte do titulo', 'alinhar os icones', 'corrigir o contraste no dark mode',
    'aplicar a paleta nova', 'deixar responsivo no mobile', 'arredondar a borda',
  ]) {
    expect(planSteps({ title: objetivo, objetivo, risk: 'low' }, DEFAULT_STEPS).profile, objetivo).toBe('visual')
  }
})

test('ESTILO vence a palavra solta de logica, mas NAO vence sinal duro', () => {
  // Vence logica: "integrar" no enunciado nao transforma cor em arquitetura.
  expect(planSteps({ title: 'x', objetivo: 'ajustar cores ao integrar o ranking', risk: 'low' }, DEFAULT_STEPS).profile).toBe('visual')
  // Nao vence seguranca/backend/dados/dependencia: ali errar para baixo custa caro.
  for (const objetivo of [
    'trocar a cor da tela de login e o token',
    'mudar o css e criar o endpoint de tema',
    'ajustar a paleta e a migration de temas',
    'atualizar o pacote de icones (bump)',
  ]) {
    expect(planSteps({ title: 'x', objetivo, risk: 'low' }, DEFAULT_STEPS).profile, objetivo).not.toBe('visual')
  }
})

test('risco alto declarado continua rodando tudo, mesmo em tarefa de cor', () => {
  const p = planSteps({ title: 'trocar a paleta', objetivo: 'trocar a paleta inteira', risk: 'high' }, DEFAULT_STEPS)
  expect(p.profile).toBe('completo')
  expect(p.steps.length).toBe(DEFAULT_STEPS.length)
})

test('a LEI ainda pode SUBIR o rigor de uma tarefa visual — o enunciado nao tem a ultima palavra', () => {
  const visual = planSteps({ title: 'cores', objetivo: 'ajustar as cores do card', risk: 'low' }, DEFAULT_STEPS)
  expect(visual.steps).toEqual([])
  const comLei = aplicarLei(visual, { forca: 'completo', motivos: ['diff toca migrations'], regras: [] }, DEFAULT_STEPS)
  expect(comLei.steps.length, 'quem olha o DIFF continua mandando').toBeGreaterThan(0)
})

test('INVARIANTE o motor CONFERE o escopo no diff, nao so pede no prompt', async () => {
  const executar = await Bun.file('motor/osw/executar.ts').text()
  expect(executar, 'sem a checagem, escopo e mais uma instrucao em texto que o modelo pode ignorar').toContain('foraDoEscopo(')
  expect(executar).toContain('escreveu FORA do escopo')
  const agente = await Bun.file('motor/cic/agente.ts').text()
  expect(agente, 'e o agente tem de saber a regra ANTES de trabalhar').toContain('ESCOPO DE ESCRITA')
})

// Colisao de vocabulario que vale registrar: `token` e de SECURITY (token de auth),
// nao de estilo. "design token" perde para "token de sessao" DE PROPOSITO — rodar
// seguranca a mais numa troca de paleta custa uma chamada de agente; nao rodar numa
// troca de token de auth custa o incidente.
test('"token" puxa para seguranca, nao para estilo — e isso e a escolha certa', () => {
  const p = planSteps({ title: 'x', objetivo: 'aplicar os tokens da paleta', risk: 'low' }, DEFAULT_STEPS)
  expect(p.profile, 'ambiguo entre design token e token de auth: erra para o lado seguro').not.toBe('visual')
  expect(p.steps.map(s => s.id)).toContain('seguranca')
  // E o caminho rapido continua disponivel para quem escreve sem a palavra ambigua:
  expect(planSteps({ title: 'x', objetivo: 'aplicar a paleta nova', risk: 'low' }, DEFAULT_STEPS).profile).toBe('visual')
})

// Achados de verificacao adversarial contra o proprio perfil `visual`. Cada um
// destes enunciados ganhava perfil 'visual' com ZERO passo de pipeline — mudanca de
// LOGICA sem Testes, sem Arquitetura, sem Seguranca.
test('REGRESSAO: palavra AMBIGUA sozinha nao da caminho rapido a mudanca de logica', () => {
  for (const objetivo of [
    'refatorar a classe de comissao',
    'corrigir o calculo do tamanho maximo do lote',
    // "renomear a variavel" fica de FORA de proposito: `renomear` esta em COSMETIC
    // desde antes, e cai em `enxuto` com zero passo por decisao anterior a esta.
    // Misturar as duas coisas neste teste esconderia qual das duas quebrou.
    'ajustar o peso da nota final',
    'validar o peso e o tamanho do lote antes de gravar',
    'corrigir as fontes de dados do relatorio',
    'trocar a margem de lucro usada no fechamento',
    'aumentar o espaco em disco reservado pelo cache',
  ]) {
    const p = planSteps({ title: objetivo, objetivo, risk: 'low' }, DEFAULT_STEPS)
    expect(p.profile, `"${objetivo}" nao e mudanca de aparencia`).not.toBe('visual')
    expect(p.steps.length, `"${objetivo}" ficou sem NENHUM passo`).toBeGreaterThan(0)
  }
})

// Duas palavras fracas juntas SIM: a evidencia deixa de ser acidental.
test('par de palavras ambiguas conta como estilo — mas LOGIC ainda veta', () => {
  expect(planSteps({ title: 'aumentar o tamanho da fonte do titulo', objetivo: 'aumentar o tamanho da fonte do titulo', risk: 'low' }, DEFAULT_STEPS).profile).toBe('visual')
  // Mesmo par, com palavra de logica: `validar` veta, porque a evidencia de estilo
  // e fraca e pular Testes numa mudanca de logica custa mais que rodar a mais.
  expect(planSteps({ title: 'validar o peso e o tamanho do lote', objetivo: 'validar o peso e o tamanho do lote', risk: 'low' }, DEFAULT_STEPS).profile).not.toBe('visual')
  // Palavra FORTE continua vencendo logica sozinha: e o caso medido do incidente.
  expect(planSteps({ title: 'combinar as cores ao integrar o ranking', objetivo: 'combinar as cores ao integrar o ranking', risk: 'low' }, DEFAULT_STEPS).profile).toBe('visual')
})

test('"fonte" e tipografia, menos quando e origem de dado', () => {
  expect(planSteps({ title: 'mudar a fonte do titulo', objetivo: 'mudar a fonte do titulo', risk: 'low' }, DEFAULT_STEPS).profile).toBe('visual')
  expect(planSteps({ title: 'definir a fonte de verdade do estado', objetivo: 'definir a fonte de verdade do estado', risk: 'low' }, DEFAULT_STEPS).profile).not.toBe('visual')
})

// Registra a ORDEM: estilo entrou em `lean`, e `lean` curto-circuitava divergir
// ANTES de ABERTO — o que desligava em silencio um divergir que ja existia.
test('pergunta aberta de desenho sobre cor ainda vale divergir', () => {
  const t = 'repensar a arquitetura do tema de cores'
  expect(valeDivergir({ title: t, objetivo: t }).vale, 'e pergunta de desenho que por acaso e sobre cor').toBe(true)
  const so = 'trocar a cor do botao para o azul da paleta'
  expect(valeDivergir({ title: so, objetivo: so }).vale, 'troca de cor nao tem alternativa de arquitetura').toBe(false)
})

test('LEI faz UNIAO de verdade — nenhum passo aprovado cai quando "completo" encolhe', () => {
  const primeiro = DEFAULT_STEPS[0]
  if (!primeiro) throw new Error('DEFAULT_STEPS vazio')
  const extra = { ...primeiro, id: 'x-especial', label: 'Especial' }
  const plano = planSteps({ title: 'trocar a cor do botao', objetivo: 'trocar a cor do botao', risk: 'low' }, DEFAULT_STEPS)
  const comExtra = { ...plano, steps: [...plano.steps, extra] }
  const sub = DEFAULT_STEPS.slice(0, 2)
  const alcado = aplicarLei(comExtra, { forca: 'completo', motivos: ['m'], regras: [] }, sub)
  expect(alcado.steps.map(s => s.id)).toContain('x-especial')
  expect(alcado.steps.length).toBe(sub.length + 1)
})

// Palavras que pareciam de aparencia e nao sao em portugues de projeto: `gap` =
// lacuna, `centralizar` = consolidar (o verbo de refactor mais comum deste repo),
// `tema` = assunto, `light` = tier de preco, `contraste`/`alinhamento` = comparacao e
// acordo. Uma delas num card de dinheiro comprava pipeline ZERO.
test('REGRESSAO: palavra que parece de estilo e nao e nao compra caminho rapido', () => {
  for (const objetivo of [
    'corrigir o bug do gap de calculo entre total e parcelas',
    'centralizar o calculo de comissao num modulo unico',
    'criar o plano light com limite de 3 usuarios',
    'rever o tema de cada aula do curso',
    'definir a fonte da verdade do cadastro de clientes',
    'definir a fonte unica de verdade do cadastro',
    'reduzir o tamanho do anexo e os tamanhos dos lotes',
    'impedir peso e tamanho acima do limite no envio do lote',
    'melhorar o contraste entre a receita prevista e a realizada',
  ]) {
    const p = planSteps({ title: objetivo, objetivo, risk: 'low' }, DEFAULT_STEPS)
    expect(p.profile, `"${objetivo}"`).not.toBe('visual')
    expect(p.steps.length, `"${objetivo}" ficou sem NENHUM passo`).toBeGreaterThan(0)
  }
})

// A contrapartida: as que sobraram em ESTILO_FORTE tem de continuar comprando.
test('o vocabulario que sobrou ainda da o caminho rapido', () => {
  for (const objetivo of [
    'trocar a cor do botao', 'ajustar o padding do card', 'arrumar o css do header',
    'mudar a fonte do titulo', 'alinhar os icones', 'corrigir o contraste no dark mode',
    'aplicar a paleta nova', 'deixar responsivo no mobile', 'arredondar a borda',
    'aumentar o tamanho da fonte do titulo',
  ]) {
    expect(planSteps({ title: objetivo, objetivo, risk: 'low' }, DEFAULT_STEPS).profile, objetivo).toBe('visual')
  }
})

// `surface` diz que existe TELA, nao que a pergunta deixou de ser de desenho: o mesmo
// enunciado nao pode mudar de resposta por causa dele.
test('ABERTO vence os TRES tipos de leve, e nao so o de estilo', () => {
  const t = 'repensar a arquitetura do tema de cores'
  expect(valeDivergir({ title: t, objetivo: t }).vale).toBe(true)
  expect(valeDivergir({ title: t, objetivo: t, surface: 'visual' }).vale, 'ter tela nao muda a pergunta').toBe(true)
})
