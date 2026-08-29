import { createInterface } from 'node:readline'
import { readCard, repoPath } from '../motor/cordel/store.ts'
import { dispatch, rotuloDoBloqueio } from '../motor/mirante/despacho.ts'
import type { DispatchIO, SituacaoDeEnvio } from '../motor/mirante/despacho.ts'
import { provedoresDisponiveis } from '../motor/tomada/disponibilidade.ts'
import { providerNameFor } from '../motor/tomada/registro.ts'
import { handle, newSession, seguir, perguntando, retomando, sincronizarAprovacao, sincronizarPergunta, respondido } from '../motor/mirante/sessao.ts'
import { perguntasDoCrivo } from '../motor/ciclo/crivo/perguntas-do-crivo.ts'
import type { SessionState } from '../motor/mirante/sessao.ts'
import { daemonPid, daemonStatus } from '../motor/oswaldo/mutirao/daemon.ts'
import { pendencia } from '../motor/mirante/responder.ts'
import { quebrarEmLargura } from '../motor/mirante/tui/layout.ts'
import { markdownParaAnsi } from '../motor/mirante/render/markdown.ts'
import { responderPergunta } from '../motor/quilombo/cartorio/responder-pergunta.ts'
import { renderParada } from '../motor/mirante/render/tarefa.ts'
import { emExecucao } from '../motor/mirante/render/rodape.ts'
import { floorProviders, formatProviders } from '../motor/euclides/tesouro/lacuna.ts'
import { createApp } from '../motor/mirante/tui/app.ts'
import { nodeTerminal } from '../motor/mirante/tui/screen.ts'
import { ACC, RESET, color, dim, say, escolherProjeto } from '../motor/mirante/cli/saida.ts'
import { larguraUtil, reposRegistrados, todosOsCards } from '../motor/mirante/cli/dados.ts'
import { definirModo, modoAtual, selecionado, selecionar } from '../motor/mirante/cli/estado.ts'
import { cabecalhoDaTarefa, planoDe } from '../motor/mirante/cli/tela-tarefa.ts'
import { dicaDaNavegacao, pintarComando, rodapeDa } from '../motor/mirante/cli/rodape-tui.ts'
import { alvoDeEntrada, avisoRepos, completer, corpoDaTela, navegarNaTela } from '../motor/mirante/cli/board-tui.ts'
import { ensureDaemon, fleet } from '../motor/mirante/cli/comandos.ts'
import { bloqueia, preflight } from '../motor/mirante/cli/preflight.ts'
import { definirEstadoDoOllama, sondarOllama } from '../motor/tomada/harness/ollama-estado.ts'

// O painel de aprovacao de URL tem tres opcoes fixas (aprova · refaz · ajusta),
// as mesmas que `alvoDeEntrada` gera como op:1..op:3.
const OPCOES_DE_APROVACAO = 3
import { etiquetaDoProjeto } from '../motor/mirante/render/projeto.ts'
import { cabemQuantasSugestoes, renderSugestoes, prefixoComum } from '../motor/mirante/render/sugestoes.ts'
import type { GrupoDeSugestao } from '../motor/mirante/render/sugestoes.ts'
import { comandosDaIaAtiva, corDaIa } from '../motor/tomada/mapa/comandos.ts'
import { aplicar as aplicarIa, ciclarModo } from '../motor/mirante/escolher-ia.ts'
import { renderAprovacao, verificacaoDoCard } from '../motor/mirante/render/aprovacao.ts'
import { renderOpcoesRodape } from '../motor/mirante/render/clarify.ts'
import * as core from '../motor/mirante/acoes.ts'

function ioDo(app: { log: (s: string) => void }, diga: (s: string) => void, repo = ''): DispatchIO {
  return {
    log: (l) => (l.startsWith(' ') || l === '' ? app.log(l) : diga(l)),
    dim,
    color,
    largura: larguraUtil,
    responder: async (pergunta, conversa) => {
      const alvo = repoPath(repo)
      const r = await responderPergunta(pergunta, alvo, conversa)
      if (!r.ok && !r.texto) return ['  nao consegui responder — a consulta falhou']
      const emAnsi = markdownParaAnsi(r.texto, { color, largura: larguraUtil() - 2 }).join('\n')
      const corpo = quebrarEmLargura(emAnsi, larguraUtil() - 2).map(l => `  ${l}`)
      const gasto = r.custo
        ? dim(`  (${r.provedor}${r.custoMedido ? '' : ', custo estimado'} · US$${r.custo.toFixed(4)})`)
        : dim(`  (${r.provedor})`)
      return [...corpo, '', gasto]
    },
    plano: async (id) => planoDe(id).split('\n'),
    daemonOnline: () => !!daemonPid(),
    iaProntaParaEnviar: (): SituacaoDeEnvio => {
      const provedor = providerNameFor('implement')
      const estado = provedoresDisponiveis().find(p => p.nome === provedor)
      if (!estado || estado.situacao === 'disponivel') return { ok: true, motivo: '' }
      const motivo = `nao da para enviar — a ia "${provedor}" ${rotuloDoBloqueio(estado.situacao)}: ${estado.comoObter} (/login mostra como resolver)`
      return { ok: false, motivo }
    },
  }
}

async function tui(state0: SessionState): Promise<void> {
  let state = state0
  const term = nodeTerminal()
  let sairPedido = false
  async function processar(linha: string): Promise<void> {
    const { effect, state: next } = handle(linha, state)
    state = next
    const diga = (s: string): void => app.log('  ' + s)
    if (effect.kind === 'quit') { sairPedido = true; app.encerrar(); return }
    const repoAntes = state.repo
    const r = await dispatch(effect, state, ioDo(app, diga, state.repo))
    state = r.state
    if (state.repo !== repoAntes) selecionar('')
    if (effect.kind === 'nova-sessao') { selecionar(''); app.limparLog() }
    if (!r.tratado && effect.kind === 'historico') state = { ...state, seguindo: '' }
  }

  const app = createApp(term, {
    header: () => `${color ? ACC : ''}hii${color ? RESET : ''}${dim(`   daemon ${daemonStatus()}`)}`,
    corpo: (ctx) => {
      definirModo(ctx.navegando)
      return corpoDaTela(state, ctx)
    },
    fixo: (ctx) => (state.seguindo && state.tela !== 'config' && ctx.navegando !== 'board' ? cabecalhoDaTarefa(state) : []),
    logPrimeiro: () => !!state.seguindo,
    telaPropria: () => state.tela === 'config',
    sairDaTela: () => { state = { ...state, tela: '' } },
    acima: () => {
      if (state.comentando) return renderAprovacao(state.comentando, { color, comentando: true, width: larguraUtil() })
      if (state.perguntando) {
        const p = pendencia(state.perguntando)
        if (p) return renderOpcoesRodape(p, { color, width: larguraUtil(), selecionado: selecionado() })
      }
      if (state.seguindo) {
        const card = readCard(state.seguindo)
        // A pergunta vem ANTES da aprovacao: se o crivo perguntou, decidir sobre a
        // URL sem responder e decidir sem a informacao que o proprio motor pediu.
        // A chave identifica a PERGUNTA, e nao so "ha pergunta": pergunta nova
        // (texto diferente) volta a chamar; a mesma, ja dispensada, nao.
        const aberta = card ? perguntasDoCrivo(card.fm, state.seguindo).find(q => !q.answer) : undefined
        state = sincronizarPergunta(state, aberta ? `${state.seguindo}:${aberta.q}` : '')
        state = sincronizarAprovacao(state, String(card?.fm.status ?? ''))
      }
      if (!state.aprovando) return []
      const cardEmAprovacao = readCard(state.aprovando)
      return renderAprovacao(state.aprovando, {
        color,
        width: larguraUtil(),
        selecionado: selecionado(),
        url: String(cardEmAprovacao?.fm.url ?? ''),
        verificacao: verificacaoDoCard(String(cardEmAprovacao?.fm.verify ?? '')),
      })
    },
    dica: (ctx) => dicaDaNavegacao(ctx, state),
    prompt: () => '› ',
    legenda: () => etiquetaDoProjeto(state.repo, {
      color,
      indice: reposRegistrados().findIndex(r => r.name === state.repo),
      detalhe: state.seguindo ? `tarefa #${state.seguindo}` : '',
    }),
    rodape: () => rodapeDa(state, modoAtual() === 'rodape'),
    intervalMs: 400,
    onComplete: (linha) => completer(linha, state.repo)[0],
    sugestoes: (opcoes, selecionado) => {
      const daIa = comandosDaIaAtiva(state.repo ? repoPath(state.repo) : '')
      const descricaoPorComando = new Map(daIa.comandos.map(c => [c.comando, c.descricao]))
      const grupoDe = (opcao: string): GrupoDeSugestao | null =>
        descricaoPorComando.has(opcao) ? { titulo: daIa.provedor, cor: corDaIa(daIa.provedor) } : null
      return renderSugestoes(opcoes, {
        color, selecionado, width: Math.max(40, (Number(process.stdout.columns) || 78) - 6),
        // A janela e dimensionada pelas linhas do terminal: sem isto o quadro
        // cortava as primeiras N por falta de altura e a navegacao morria num
        // terminal baixo.
        maxLinhas: cabemQuantasSugestoes(Number(process.stdout.rows) || 24),
        grupoDe, descricaoDe: (opcao) => descricaoPorComando.get(opcao),
      })
    },
    prefixoComum,
    corInput: (linha) => pintarComando(linha),
    onInterrupt: () => {
      const id = state.seguindo
      const card = id ? readCard(id) : null
      const status = String(card?.fm.status ?? '')
      if (!card || !['EXECUTING', 'CORRECTING'].includes(status)) {
        sairPedido = true
        return true
      }
      core.halt(id, 'parado pelo humano (ctrl+c)')
      state = retomando(state, id)
      const custo = parseFloat(String(card.fm.cost_usd ?? '0')) || 0
      for (const l of renderParada(id, {
        color, custo: custo.toFixed(2),
        pisoDoGasto: formatProviders(floorProviders(card.fm)),
        width: Math.max(40, (Number(process.stdout.columns) || 78) - 6),
      })) app.log(l)
      return false
    },
    onNav: (dir, modo) => navegarNaTela(state, dir, modo),
    onCiclarModo: (dir) => {
      const r = ciclarModo('implement', dir)
      app.log(`  ${r.mensagem}`)
    },
    onAba: (dir) => {
      const nomes = reposRegistrados().map(r => r.name)
      if (nomes.length < 2) return
      const i = nomes.indexOf(state.repo)
      const proximo = nomes[(i + dir + nomes.length) % nomes.length] ?? state.repo
      state = { ...state, repo: proximo }
      selecionar('')
    },
    podeLimpar: () => {
      const rodando = emExecucao(todosOsCards(), state.repo, Date.now(), () => '')
      if (!rodando.length) return ''
      const ids = rodando.map(e => `#${e.id}`).join(' ')
      return `${ids} em execucao — a area so limpa quando terminar`
    },
    // O numero so responde quando HA painel de opcao aberto — pergunta do crivo, do
    // CLARIFY, ou aprovacao de URL. Fora disso ele recusa e o caractere vai para a
    // linha, como sempre: digitar "1" para escrever "1" continua funcionando.
    // ESC sai do modo de pergunta e devolve a navegacao. O aviso "o crivo perguntou"
    // continua no cabecalho da tarefa — dispensar tira o modo do caminho, nao
    // esconde que ha pergunta. Escolher a tarefa de novo no quadro reabre.
    onDispensar: () => {
      if (!state.perguntando) return false
      state = respondido(state)
      selecionar('')
      return true
    },
    onNumero: (n) => {
      // Quantas opcoes existem AGORA. Nao basta "ha painel": exigir opcao ja
      // SELECIONADA obrigaria a navegar com as setas antes de digitar o numero, que e
      // exatamente o passo a mais que este atalho existe para tirar.
      //
      // `comentando` fica de fora de proposito: ali se escreve texto livre, e um "1"
      // no comeco do comentario e o caractere 1.
      const quantas = state.comentando ? 0
        : state.aprovando ? OPCOES_DE_APROVACAO
        : state.perguntando ? (pendencia(state.perguntando)?.atual.options.length ?? 0)
        : 0
      if (Number(n) > quantas) return false
      selecionar('')
      void processar(n)
      return true
    },
    onEntrar: (modo) => {
      const alvo = alvoDeEntrada(modo, state)
      if (alvo.kind === 'nada') return
      if (alvo.kind === 'provedor') {
        app.log(`  ${aplicarIa({ papeis: ['implement'], provider: alvo.nome }).mensagem}`)
        return
      }
      if (alvo.kind === 'opcao') {
        selecionar('')
        void processar(alvo.escolha)
        return
      }
      selecionar('')
      state = seguir(state, alvo.id)
      if (pendencia(alvo.id)) state = perguntando(state, alvo.id)
      state = sincronizarAprovacao(state, String(readCard(alvo.id)?.fm.status ?? ''))
      app.limparLog()
    },
    onLine: processar,
  })
  await app.run()
  if (sairPedido) say(dim('  sessao encerrada — os cards seguem rodando'))
}

async function main(): Promise<void> {
  let repoAtual = ''
  const rl = createInterface({
    input: process.stdin, output: process.stdout,
    completer: (linha: string) => completer(linha, repoAtual),
  })
  const lines = rl[Symbol.asyncIterator]()
  const ask = async (q: string): Promise<string | null> => {
    process.stdout.write(q)
    const { value, done } = await lines.next()
    return done ? null : String(value)
  }
  say('')
  say(`  ${color ? ACC : ''}hii${color ? RESET : ''} — motor de execucao   ${dim('/help para os comandos')}`)
  const estadoOllama = await sondarOllama()
  definirEstadoDoOllama(estadoOllama)
  const diagnostico = preflight(estadoOllama.habilitado)
  for (const c of diagnostico.filter(c => c.severidade !== 'ok')) {
    const marca = c.severidade === 'erro' ? '!' : '·'
    say(dim(`  ${marca} ${c.nome}: ${c.detalhe}${c.conserto ? ` — ${c.conserto}` : ''}`))
  }
  if (bloqueia(diagnostico)) {
    say(dim('  ambiente incompleto — resolva o acima antes de abrir o hii'))
    rl.close()
    return
  }
  await ensureDaemon(ask)
  let state = newSession(await escolherProjeto(ask))
  repoAtual = state.repo
  avisoRepos(state)
  if (color) {
    rl.close()
    await tui(state)
    return
  }
  fleet(state)

  for (;;) {
    const line = await ask(color ? `${ACC}› ${RESET}` : '› ')
    if (line === null) break
    const { effect, state: next } = handle(line, state)
    state = next
    if (effect.kind === 'quit') break
    if (effect.kind === 'reopen-repo') {
      state = { ...state, repo: await escolherProjeto(ask) }
      repoAtual = state.repo
      fleet(state)
      continue
    }
    const passo = await dispatch(effect, state, ioDo({ log: (l) => say(l) }, (l) => say(dim('  ' + l)), state.repo))
    state = passo.state
    repoAtual = state.repo
  }
  rl.close()
  say(dim('  sessao encerrada — os cards seguem rodando'))
}

await main()