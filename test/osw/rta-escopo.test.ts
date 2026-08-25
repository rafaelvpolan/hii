import { test, expect, lerArquivo } from '../apoio/runner.ts'
import { caminhosCitados, foraDoEscopo, lerEscopo, SEM_ESCOPO } from '../../motor/osw/rta/escopo.ts'

// O incidente: o pedido citou dois caminhos — um como padrão a seguir, outro como
// lugar de execução — e o motor não tinha como distinguir, então o agente editou a
// referência. `dirs = [worktree]` com `mode: 'edit'` deixa tudo gravável.
const PROMPT_REAL = 'faça uma analise de cores do podium top 3, veja se as cores estão de acordo com o padrão barbeiro-frontend/ esta sendo feito/executado em ui-lab/leaderboard-barbeiro.html, objetivo ao integrar o ranking no barbeiro deve combinar as cores.'

test('o pedido real: barbeiro-frontend e REFERENCIA, o html e ALVO', () => {
  const e = lerEscopo(PROMPT_REAL)
  expect(e.alvos).toEqual(['ui-lab/leaderboard-barbeiro.html'])
  expect(e.referencias).toEqual(['barbeiro-frontend'])
})

test('editar a referencia fica FORA do escopo, e o alvo dentro', () => {
  const e = lerEscopo(PROMPT_REAL)
  expect(foraDoEscopo(e, ['ui-lab/leaderboard-barbeiro.html'])).toEqual([])
  expect(foraDoEscopo(e, ['barbeiro-frontend/tokens.css']), 'foi exatamente isto que aconteceu')
    .toEqual(['barbeiro-frontend/tokens.css'])
  expect(foraDoEscopo(e, ['barbeiro-frontend'])).toEqual(['barbeiro-frontend'])
})

test('sem marcador nenhum, NAO ha escopo — o comportamento e o de sempre', () => {
  // Adivinhar aqui trocaria "editou onde nao devia" por "nao consegue editar onde
  // devia", que e pior: o primeiro aparece no diff, o segundo parece motor quebrado.
  expect(lerEscopo('deixa o botao mais bonito')).toEqual(SEM_ESCOPO)
  expect(lerEscopo('mexer em src/app.ts e src/util.ts').referencias, 'os dois sao alvo, nenhum e referencia').toEqual([])
  expect(lerEscopo('olha o arquivo src/app.ts').alvos).toEqual(['src/app.ts'])
})

test('marcador de referencia vence o de alvo quando os dois cabem na frase', () => {
  // "de acordo com o padrao X" tem "com" e "o" antes do caminho: lido como alvo,
  // o motor autorizaria escrita justamente onde nao devia.
  const e = lerEscopo('deixe igual ao padrao design-system/tokens.css')
  expect(e.referencias).toEqual(['design-system/tokens.css'])
  expect(e.alvos).toEqual([])
})

test('escrever vence ler: caminho marcado como alvo em algum ponto nao e referencia', () => {
  const e = lerEscopo('siga o padrao src/tema.css e aplique em src/tema.css')
  expect(e.alvos).toEqual(['src/tema.css'])
  expect(e.referencias, 'senao o motor bloquearia a escrita no proprio alvo').toEqual([])
})

test('prosa com barra nao vira caminho quando ha checagem de existencia', () => {
  const citados = caminhosCitados(PROMPT_REAL).map(c => c.caminho)
  expect(citados, 'sem filtro, a forma de caminho casa em prosa').toContain('feito/executado')
  const existe = (p: string): boolean => p !== 'feito/executado'
  const e = lerEscopo(PROMPT_REAL, existe)
  expect(e.alvos).toEqual(['ui-lab/leaderboard-barbeiro.html'])
  expect(e.referencias).toEqual(['barbeiro-frontend'])
})

test('o filtro de existencia pode zerar o escopo, e ai vale o comportamento de sempre', () => {
  expect(lerEscopo(PROMPT_REAL, () => false)).toEqual(SEM_ESCOPO)
})

test('referencia protege mesmo sem alvo declarado', () => {
  const e = lerEscopo('use as cores conforme design-system/')
  expect(e.alvos).toEqual([])
  expect(e.referencias).toEqual(['design-system'])
  expect(foraDoEscopo(e, ['design-system/a.css']), '"nao escreva aqui" vale por si').toEqual(['design-system/a.css'])
  expect(foraDoEscopo(e, ['src/app.css']), 'o resto do worktree segue livre').toEqual([])
})

test('subdiretorio conta como dentro, prefixo parecido NAO', () => {
  const e = lerEscopo('conforme app/ui/ e aplique em app/web/tema.css')
  expect(foraDoEscopo(e, ['app/ui/cores.css'])).toEqual(['app/ui/cores.css'])
  expect(foraDoEscopo(e, ['app/uixyz/cores.css']), 'app/uixyz nao esta dentro de app/ui').toEqual([])
})

test('sem referencia declarada, nada fica fora do escopo', () => {
  expect(foraDoEscopo(lerEscopo('aplique em src/a.css'), ['qualquer/outro.ts'])).toEqual([])
})

// O plano e a execucao NAO podem ler o escopo de textos diferentes: o plano e o
// que o humano aprova, e um escopo que muda depois da aprovacao e promessa quebrada.
test('INVARIANTE plano e motor leem o escopo do MESMO texto', async () => {
  const plano = await lerArquivo('motor/nmy/luc/plano.ts')
  const agente = await lerArquivo('motor/cic/agente.ts')
  for (const fonte of [plano, agente]) {
    expect(fonte, 'instrucao anexada depois do plano tem de entrar nos dois lados').toContain('objetivoComInstrucoes(card.body')
  }
  expect(plano).toContain('lerEscopo(')
  expect(agente).toContain('lerEscopo(')
})

test('INVARIANTE a tela do plano passa a checagem de existencia — senao mostra prosa como arquivo', async () => {
  const tela = await lerArquivo('motor/mir/cli/tela-tarefa.ts')
  expect(tela, 'sem existeNoAlvo, "feito/executado" apareceria como caminho no plano').toContain('existeNoAlvo:')
})

test('caminho absoluto e ./ nao escapam da referencia', () => {
  const e = lerEscopo('conforme design-system/ e aplique em src/a.css')
  expect(foraDoEscopo(e, ['./design-system/x.css']), './ tem de normalizar').toEqual(['./design-system/x.css'])
})

// A preposicao NUA (`em|no|na`) e tao comum antes de uma REFERENCIA quanto antes de
// um alvo. Aceita-la fazia os dois caminhos virarem alvo, `referencias` ficar vazio,
// e o prompt AUTORIZAR explicitamente a escrita na referencia — o incidente voltava
// com uma reformulacao trivial do pedido.
test('REGRESSAO: preposicao sozinha nao marca alvo — marca de alvo pede verbo de escrita', () => {
  const e = lerEscopo('as cores estao em referencia/tokens.css, aplique no alvo.html')
  expect(e.alvos, 'so o que tem verbo de escrita').toEqual(['alvo.html'])
  expect(e.referencias, 'sem marca explicita o caminho nao vira alvo nem referencia').toEqual([])
  expect(foraDoEscopo(e, ['referencia/tokens.css']), 'sem referencia declarada nao ha o que barrar — mas tambem nao ha autorizacao falsa').toEqual([])
})

test('o pedido real do incidente continua classificado certo', () => {
  const e = lerEscopo('analise de cores, veja se estao de acordo com o padrao barbeiro-frontend/ esta sendo feito/executado em ui-lab/leaderboard-barbeiro.html')
  expect(e.alvos).toEqual(['ui-lab/leaderboard-barbeiro.html'])
  expect(e.referencias).toEqual(['barbeiro-frontend'])
})

// O texto vem do PEDIDO, e o pedido nao manda no sistema de arquivos: o caminho que
// sai do alvo nunca e escopo. Sem isto, `existsSync(join(alvo, '../../etc/passwd'))`
// da verdadeiro e "escreva somente em ../../etc/passwd" chega ao prompt do agente
// como autorizacao.
test('caminho que sai do alvo nao entra no escopo', () => {
  expect(caminhosCitados('aplique em ../../etc/passwd').map(c => c.caminho)).toEqual([])
  expect(lerEscopo('aplique em ../../etc/passwd', () => true).alvos).toEqual([])
  // Caminho ABSOLUTO ja era inofensivo por outro motivo: o extrator nao leva a
  // barra inicial, entao "/etc/hosts" sai como "etc/hosts" e o join fica DENTRO do
  // alvo. Fica registrado porque e facil "consertar" isso e reabrir a fuga.
  expect(caminhosCitados('conforme /etc/hosts').map(c => c.caminho)).toEqual(['etc/hosts'])
})

// "nao edite X" e a frase mais natural para declarar a restricao — e era a que a
// desligava: `edit\w+` marcava X como ALVO, "escrever vence ler" tirava X de
// `referencias`, `referencias` vazio fazia `foraDoEscopo` curto-circuitar, e o prompt
// passava a AUTORIZAR a escrita ali. A frase que proibia era a que liberava.
test('REGRESSAO: negacao antes do verbo de escrita declara REFERENCIA, nao alvo', () => {
  for (const pedido of [
    'aplique em alvo/index.html conforme ref/tokens.css. nao edite ref/tokens.css',
    'conforme ref/tokens.css nao altere ref/tokens.css',
    'conforme ref/tokens.css nao mexa em ref/tokens.css',
    'aplique em alvo.html sem tocar em ref/tokens.css',
    'nao apague ref/tokens.css, ajuste em src/a.css',
  ]) {
    const e = lerEscopo(pedido)
    expect(e.alvos, `"${pedido}" nao pode marcar a referencia como alvo`).not.toContain('ref/tokens.css')
    expect(foraDoEscopo(e, ['ref/tokens.css']), `"${pedido}" tem de barrar`).toEqual(['ref/tokens.css'])
  }
})

// "conforme o padrao ref/tokens.css." dava `ref/tokens.css.` — que nunca casa com o
// caminho que o git reporta. A referencia existia no card e nao barrava nada.
test('REGRESSAO: pontuacao final nao entra no caminho', () => {
  const e = lerEscopo('conforme o padrao ref/tokens.css. aplique em alvo.html')
  expect(e.referencias).toEqual(['ref/tokens.css'])
  expect(foraDoEscopo(e, ['ref/tokens.css'])).toEqual(['ref/tokens.css'])
})

// O primeiro cumprimento (osw/executar.ts) ve so a escrita do implement. Depois dele
// ainda escrevem o ajuste de url, o reparo e os passos do pipeline — e o prompt de
// todos AFIRMAVA que o motor confere. O segundo ponto e no fecho, contra
// origin/<base>, entao cobre tudo o que entrou no branch, de qualquer origem.
test('INVARIANTE o escopo e cumprido em DOIS pontos, nao so depois do implement', async () => {
  const executar = await lerArquivo('motor/osw/executar.ts')
  const fechar = await lerArquivo('motor/qlb/ctr/fechar.ts')
  expect(executar, 'primeiro ponto: logo depois do implement').toContain('foraDoEscopo(escopo,')
  expect(fechar, 'segundo ponto: contra o diff do branch inteiro').toContain('foraDoEscopo(escopoDoCard(card, wt), changed)')
})

// O prompt nao pode anunciar cumprimento que nao existe: `foraDoEscopo` barra escrita
// DENTRO de referencia declarada, e nao trata todo caminho nao citado como proibido.
// Anunciar o que nao acontece calibra o modelo errado.
test('INVARIANTE a promessa do prompt cobre so o que o motor cumpre', async () => {
  const agente = await lerArquivo('motor/cic/agente.ts')
  const bloco = agente.slice(agente.indexOf('function blocoDeEscopo'), agente.indexOf('function blocoDeEscopo') + 1800)
  const linhaDaPromessa = bloco.split('\n').find(l => l.includes('CONFERE isto no diff'))
  expect(linhaDaPromessa, 'a promessa tem de existir').toBeDefined()
  expect(bloco.indexOf('CONFERE isto no diff'), 'e ficar DENTRO do ramo de referencia').toBeGreaterThan(bloco.indexOf('SO LEITURA'))
  const e = lerEscopo('aplique em src/a.css')
  expect(foraDoEscopo(e, ['outro/lugar.css']), 'alvo sem referencia nao barra nada — por desenho').toEqual([])
})
