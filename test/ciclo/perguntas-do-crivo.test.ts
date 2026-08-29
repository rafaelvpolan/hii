import { test, expect, afterAll, lerArquivo } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-crivo-q-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(join(process.env.HICODE_CARDS_DIR, 'runs'), { recursive: true })
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const { createCard, readCard, patchCard } = await import('../../motor/cordel/store.ts')
const { perguntasDoCrivo, temPerguntaAberta, linhasParaOPr } = await import('../../motor/ciclo/crivo/perguntas-do-crivo.ts')
const { pendencia, responder } = await import('../../motor/mirante/responder.ts')
const { pendenciaDoStatus } = await import('../../motor/mirante/render/pendencia.ts')

// As tres perguntas reais do card 001, que ficaram invisiveis no frontmatter.
const TRES = [
  'package.json e o lockfile foram alterados nesta branch para adicionar vitest, ou o pacote ja existia?',
  'Voce rodou "vitest run" e viu as 12+ asercoes passarem em verde, ou so leu o arquivo?',
  'vite.config.ts ganhou plugin novo — isso foi validado com um build real?',
]

function cardComPerguntas(status = 'HALTED'): string {
  const id = createCard({ title: 'verificar problemas de seo', status, repo: 'org/site' }, '## Objetivo\nseo\n')
  patchCard(id, { review_verdict: 'CONDITIONAL', review_questions: JSON.stringify(TRES) })
  return id
}

// O DEFEITO: `persistGate` gravava `review_questions` e o motor inteiro nao tinha um
// leitor. O card parava com as perguntas dentro do frontmatter, e a TUI dizia so
// "a tarefa parou — enter retoma".
test('REGRESSAO: pergunta do crivo vira pendencia visivel, e nao texto morto no card', () => {
  const id = cardComPerguntas()
  const card = readCard(id)
  expect(card, 'card criado').toBeDefined()
  expect(temPerguntaAberta(card?.fm ?? {}, id), 'o motor tem de VER a pergunta').toBe(true)
  expect(perguntasDoCrivo(card?.fm ?? {}, id).length).toBe(3)

  const p = pendencia(id)
  expect(p, 'sem pendencia, a TUI nao entra no modo de resposta').not.toBeNull()
  expect(p?.origem).toBe('crivo')
  expect(p?.atual.q).toContain('package.json')
  expect(p?.atual.options.length, 'sem opcao, responder exigiria digitar frase inteira').toBe(3)
})

test('REGRESSAO: a pendencia ANUNCIA a pergunta em vez de so dizer que a tarefa parou', () => {
  const semPergunta = pendenciaDoStatus('HALTED', '1', false)
  expect(semPergunta?.titulo).toContain('parou')
  const comPergunta = pendenciaDoStatus('HALTED', '1', true)
  expect(comPergunta?.titulo, 'quem opera precisa saber que ha pergunta').toContain('crivo perguntou')
  expect(comPergunta?.acoes.some(a => a.tecla === 'numero'), 'e como responder').toBe(true)
})

// A pergunta do crivo aparece em QUALQUER status: ela e sobre o que ja foi feito.
test('a pergunta vence o status — vale em HALTED, URL e PR_OPEN', () => {
  for (const status of ['HALTED', 'URL', 'PR_OPEN', 'URL_OK']) {
    expect(pendenciaDoStatus(status, '1', true)?.titulo, status).toContain('crivo perguntou')
  }
})

test('responder grava a resposta e caminha para a proxima', () => {
  const id = cardComPerguntas()
  const r1 = responder(id, '1')
  expect(r1.ok, r1.reason).toBe(true)
  expect(r1.resposta).toBe('sim')
  expect(r1.restantes, 'faltam duas').toBe(2)
  expect(r1.retomou, 'pergunta do crivo NAO retoma o card — a decisao segue do humano').toBe(false)
  expect(pendencia(id)?.indice, 'a segunda pergunta assume').toBe(1)

  const diario = readCard(id)?.body ?? ''
  expect(diario, 'a resposta tem de ficar auditavel').toContain('resposta ao crivo')
  expect(diario).toContain('sim')
})

test('texto livre tambem responde — as opcoes nao sao camisa de forca', () => {
  const id = cardComPerguntas()
  const r = responder(id, 'o lockfile ja tinha vitest desde a semana passada')
  expect(r.ok).toBe(true)
  expect(r.resposta).toContain('lockfile ja tinha')
})

test('respondidas todas, o card marca e a pendencia some', () => {
  const id = cardComPerguntas()
  responder(id, '1'); responder(id, '2'); responder(id, '3')
  expect(pendencia(id), 'nada mais a responder').toBeNull()
  expect(readCard(id)?.fm.review_respondido).toBe('sim')
  expect(temPerguntaAberta(readCard(id)?.fm ?? {}, id)).toBe(false)
})

// A resposta tem de CHEGAR a algum lugar que importe, senao e outro valor calculado
// e nunca aplicado — o defeito que este arquivo inteiro conserta.
test('a resposta entra no corpo do PR, no lugar da caixa vazia', () => {
  const id = cardComPerguntas()
  responder(id, '1')
  const linhas = linhasParaOPr(id, TRES)
  expect(linhas[0], 'respondida vira marcada e mostra a resposta').toContain('[x]')
  expect(linhas[0]).toContain('respondido:')
  expect(linhas[1], 'nao respondida segue como caixa vazia').toContain('[ ]')
})

// Rodada nova do crivo troca as perguntas: resposta velha nao pode ser herdada por
// pergunta que ninguem fez.
test('pergunta nova nao herda resposta de pergunta que nao existe mais', () => {
  const id = cardComPerguntas()
  responder(id, '1')
  patchCard(id, { review_questions: JSON.stringify(['o build de producao roda sem erro?']) })
  const perguntas = perguntasDoCrivo(readCard(id)?.fm ?? {}, id)
  expect(perguntas.length).toBe(1)
  expect(perguntas[0]?.answer, 'resposta de outra pergunta nao vale para esta').toBeUndefined()
  expect(temPerguntaAberta(readCard(id)?.fm ?? {}, id)).toBe(true)
})

test('card sem pergunta do crivo segue exatamente como antes', () => {
  const id = createCard({ title: 'sem pergunta', status: 'HALTED', repo: 'org/site' }, '## Objetivo\nx\n')
  expect(temPerguntaAberta(readCard(id)?.fm ?? {}, id)).toBe(false)
  expect(pendencia(id)).toBeNull()
  expect(pendenciaDoStatus('HALTED', id, false)?.titulo).toContain('parou')
})

test('review_questions corrompido nao derruba a TUI', () => {
  const id = createCard({ title: 'corrompido', status: 'HALTED', repo: 'org/site' }, '## Objetivo\nx\n')
  patchCard(id, { review_questions: '{{{nao e json' })
  expect(() => perguntasDoCrivo(readCard(id)?.fm ?? {}, id)).not.toThrow()
  expect(perguntasDoCrivo(readCard(id)?.fm ?? {}, id)).toEqual([])
})

const { renderOpcoesRodape } = await import('../../motor/mirante/render/clarify.ts')

// A pergunta era pintada com DIM — o mesmo cinza das dicas de tecla. A coisa que
// exige decisao ficava menos visivel que a legenda ao lado dela.
test('REGRESSAO: a pergunta NAO e o texto mais apagado da tela', () => {
  const id = cardComPerguntas()
  const p = pendencia(id)
  expect(p).not.toBeNull()
  const linhas = renderOpcoesRodape(p!, { color: true, width: 100, selecionado: '' })
  const daPergunta = linhas.find(l => l.includes('package.json'))
  expect(daPergunta, 'a pergunta tem de aparecer').toBeDefined()
  expect(daPergunta, 'DIM e o cinza das dicas — a pergunta nao pode usar o mesmo').not.toContain('\x1b[2m')
  expect(daPergunta, 'destaque, no mesmo tom de "precisa de voce"').toContain('\x1b[1;33m')
})

// Cortar em uma linha escondia o essencial: as perguntas do crivo chegam a 240
// caracteres, e sobrava o comeco de uma frase sem o que ela pergunta.
test('REGRESSAO: pergunta longa e QUEBRADA em linhas, e nao cortada', () => {
  const id = createCard({ title: 'longa', status: 'HALTED', repo: 'org/site' }, '## Objetivo\nx\n')
  const longa = 'vite.config.ts ganhou plugin novo (faqStructuredData) que roda no build inteiro — isso foi validado com um build real confirmando que o script type=application/ld+json aparece no HTML final, ou so a funcao foi lida?'
  patchCard(id, { review_questions: JSON.stringify([longa]) })
  const p = pendencia(id)
  const linhas = renderOpcoesRodape(p!, { color: false, width: 100, selecionado: '' })
  const texto = linhas.join(' ')
  expect(texto, 'o fim da pergunta e o que ela de fato pergunta').toContain('ou so a funcao foi lida?')
  expect(linhas.filter(l => l.trim() && !/^\s*[›\s]\s*\d/.test(l)).length, 'tem de ocupar mais de uma linha').toBeGreaterThan(2)
})

// O que o usuario pediu: as respostas vem da IA, e nao de uma lista generica.
test('as opcoes vem da IA quando ela as propoe', () => {
  const id = createCard({ title: 'com opcoes', status: 'HALTED', repo: 'org/site' }, '## Objetivo\nx\n')
  patchCard(id, { review_questions: JSON.stringify([
    { q: 'o vitest foi instalado nesta branch?', opcoes: ['sim, package.json e bun.lock mudaram', 'nao, ja existia antes', 'o teste importa vitest mas o pacote nunca entrou'] },
  ]) })
  const p = pendencia(id)
  expect(p?.atual.options).toEqual(['sim, package.json e bun.lock mudaram', 'nao, ja existia antes', 'o teste importa vitest mas o pacote nunca entrou'])
  const r = responder(id, '3')
  expect(r.resposta, 'a resposta gravada e a da IA, com o teor inteiro').toBe('o teste importa vitest mas o pacote nunca entrou')
})

// Card gravado antes deste contrato nao pode virar ilegivel.
test('pergunta sem opcao cai na reserva, e nao em campo vazio', () => {
  const id = cardComPerguntas()
  const p = pendencia(id)
  expect(p?.atual.options.length, 'sem opcao, responder exigiria digitar frase inteira').toBe(3)
  expect(p?.atual.options[0]).toBe('sim')
})

test('o parser do crivo aceita as duas formas de pergunta', async () => {
  const { buildParsed } = await import('../../motor/ciclo/crivo/gate.ts')
  const antigo = buildParsed('{"verdict":"CONDITIONAL","reason":"r","questions":["so texto"]}', 0, 0)
  expect(antigo.questions[0]?.q).toBe('so texto')
  expect(antigo.questions[0]?.opcoes).toEqual([])

  const novo = buildParsed('{"verdict":"CONDITIONAL","reason":"r","questions":[{"q":"com opcoes","opcoes":["a","b"]}]}', 0, 0)
  expect(novo.questions[0]?.q).toBe('com opcoes')
  expect(novo.questions[0]?.opcoes).toEqual(['a', 'b'])
})

// O prompt tem de PEDIR o que o parser sabe ler, senao a IA nunca manda opcao.
test('INVARIANTE o prompt do crivo pede opcoes concretas, e nao sim/nao', async () => {
  const fonte = await lerArquivo('motor/ciclo/crivo/gate.ts')
  const pedidos = fonte.split('\n').filter(l => l.includes('OPCOES de resposta'))
  expect(pedidos.length, 'os dois modos do crivo — criterio escrito e gauntlet').toBe(2)
  for (const l of pedidos) expect(l, 'generico nao informa nada a quem le depois').toContain('sim/nao')
  expect(fonte, 'o formato pedido tem de casar com o que o parser le').toContain('"q":"pergunta","opcoes"')
})

// As perguntas dos cards 001 e 003 sairam enderecadas a pessoa errada: "Voce rodou
// `npx vitest run`?", "Voce rodou `npm run dev`?". Quem rodou (ou nao) foi o AGENTE.
// O humano e revisor — responder isso seria avalizar o relato do agente, que e o que
// este gate existe para nao aceitar. Mesmo erro do RED, um nivel acima.
test('INVARIANTE o prompt PROIBE perguntar ao humano o que o agente executou', async () => {
  const fonte = await lerArquivo('motor/ciclo/crivo/gate.ts')
  const proibicoes = fonte.split('\n').filter(l => l.includes('NAO ESCREVEU O CODIGO') || l.includes('NAO PRODUZIU'))
  expect(proibicoes.length, 'os dois modos do crivo').toBe(2)
  expect(fonte, 'a forma exata que os cards reais produziram').toContain('voce rodou')
  expect(fonte, 'e o que perguntar no lugar').toContain('esta NO DIFF')
})

const { newSession, seguir, sincronizarPergunta, respondido } = await import('../../motor/mirante/sessao.ts')

// A primeira versao re-armava o modo de pergunta a CADA desenho enquanto houvesse
// pergunta aberta. Dispensar (esc, ir para outra tarefa) era desfeito no quadro
// seguinte: a pessoa ficava presa naquele card sem conseguir navegar.
test('REGRESSAO: dispensar a pergunta LIBERA a navegacao, e nao e desfeito no proximo quadro', () => {
  const id = cardComPerguntas()
  const chave = `${id}:primeira`
  const dentro = seguir(newSession('org/app'), id)

  const armado = sincronizarPergunta(dentro, chave)
  expect(armado.perguntando, 'a pergunta tem de chamar uma vez').toBe(id)

  const dispensado = respondido(armado)
  expect(dispensado.perguntando).toBe('')

  const depois = sincronizarPergunta(dispensado, chave)
  expect(depois.perguntando, 're-armar aqui e o que prendia a pessoa no card').toBe('')
})

test('pergunta NOVA volta a chamar — dispensar vale para aquela pergunta, nao para sempre', () => {
  const id = cardComPerguntas()
  const dentro = seguir(newSession('org/app'), id)
  const dispensado = respondido(sincronizarPergunta(dentro, `${id}:primeira`))
  const comOutra = sincronizarPergunta(dispensado, `${id}:segunda`)
  expect(comOutra.perguntando, 'texto diferente e outra pergunta').toBe(id)
})

test('sem pergunta aberta, nada e armado', () => {
  const dentro = seguir(newSession('org/app'), '001')
  expect(sincronizarPergunta(dentro, '').perguntando).toBe('')
})

// Dispensar nao pode ESCONDER que ha pergunta — so tirar o modo do caminho.
test('o aviso continua no cabecalho depois de dispensar', () => {
  const id = cardComPerguntas()
  const card = readCard(id)
  expect(temPerguntaAberta(card?.fm ?? {}, id), 'o aviso le o CARD, nao o estado da sessao').toBe(true)
  const p = pendenciaDoStatus('HALTED', id, true)
  expect(p?.acoes.some(a => a.texto.includes('reabre')), 'e tem de dizer como voltar').toBe(true)
})

const { ordemDoRodape } = await import('../../motor/mirante/cli/board-tui.ts')

// A lista de navegacao trazia SO as opcoes quando havia pergunta, e `navegar` limita
// no ultimo item: descer nao levava a lugar nenhum. Com pergunta aberta nao havia
// como ir para outra tarefa — a pessoa ficava presa naquele card.
test('REGRESSAO: descer alem da ultima opcao entra nas TAREFAS, e nao trava', () => {
  const id = cardComPerguntas()
  const dentro = { ...seguir(newSession('org/site'), id), perguntando: id }
  const ordem = ordemDoRodape(dentro, 'rodape')
  const opcoes = ordem.filter(x => x.startsWith('op:'))
  expect(opcoes.length, 'as opcoes vem primeiro').toBeGreaterThan(0)
  expect(ordem.length, 'e a lista CONTINUA nas tarefas').toBeGreaterThan(opcoes.length)
  expect(ordem.slice(0, opcoes.length), 'a ordem e opcoes e depois tarefas').toEqual(opcoes)
})

test('o mesmo vale para o painel de aprovacao', () => {
  const id = cardComPerguntas('URL')
  const dentro = { ...seguir(newSession('org/site'), id), aprovando: id }
  const ordem = ordemDoRodape(dentro, 'rodape')
  expect(ordem.slice(0, 3)).toEqual(['op:1', 'op:2', 'op:3'])
  expect(ordem.length, 'aprovar tambem nao pode ser um poco').toBeGreaterThan(3)
})

// Trocar de tarefa deixa a pergunta da anterior para tras.
test('REGRESSAO: ir para outra tarefa solta o modo de pergunta da anterior', () => {
  const a = cardComPerguntas()
  const b = createCard({ title: 'outra', status: 'READY', repo: 'org/site' }, '## Objetivo\nx\n')
  const dentro = { ...seguir(newSession('org/site'), a), perguntando: a, perguntaVista: `${a}:x` }
  const trocou = seguir(dentro, b)
  expect(trocou.perguntando, 'ficaria presa no card antigo').toBe('')
  expect(trocou.perguntaVista).toBe('')
  expect(seguir(dentro, a).perguntando, 'voltar para a MESMA tarefa nao derruba o modo').toBe(a)
})
