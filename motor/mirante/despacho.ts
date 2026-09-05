import { comandoManual, camposDoIntake } from './comandos-manuais.ts'
import { pedirPassoManual, pedirSuiteManual } from '../quilombo/cartorio/passos-manuais.ts'
import { perguntaDeFecho } from '../quilombo/cartorio/confirmar-fecho.ts'
import { readCard, allCards, normalizeId, listRepos, repoPath, patchCard } from '../cordel/store.ts'
import { isoNow } from '../cordel/util.ts'
import { umaLinha } from './instruir.ts'
import * as core from './acoes.ts'
import { planejarLote, removerLote } from '../cordel/remover.ts'
import { renderRemocao, renderResultado } from './render/remocao.ts'
import { projetosConhecidos } from '../cordel/projetos-conhecidos.ts'
import { interpretar, aplicar as aplicarIa, limpar as limparIa, ajuda as ajudaDeIa, estadoDaIa, definirModelo, definirEsforco, definirModoDeOperacao, definirGauntlet } from './escolher-ia.ts'
import { agentRoles, isProviderName, providerNameFor } from '../tomada/registro.ts'
import { comandoDeLoginDoProvedor, provedoresDisponiveis } from '../tomada/disponibilidade.ts'
import { comandosDaIaAtiva } from '../tomada/mapa/comandos.ts'
import type { AgentRole, HarnessId } from '../tomada/tipos.ts'
import { pendencia, responder } from './responder.ts'
import { renderPergunta } from './render/clarify.ts'
import { instruir } from './instruir.ts'
import { renderHelp } from './render/help.ts'
import { esperandoVoce } from './render/rodape.ts'
import { newSession, seguir, foraDaTarefa, planShown, removendo, respondido, escolhendoRepo, aprovando, comentando, semAprovacao, comConversa } from './sessao.ts'
import { alvoDeRef, comandoRef } from './refs-comando.ts'
import { migrarRefsDaSessao, limparSessao } from '../quilombo/alfandega/anexo.ts'
import { reiniciarSessao, sessaoAtual } from '../euclides/sessao.ts'
import type { Effect, SessionState } from './sessao.ts'
import { situacaoDoCard } from './cli/situacao-cli.ts'

export interface SituacaoDeEnvio {
  ok: boolean
  motivo: string
}

export interface DispatchIO {
  log: (linha: string) => void
  dim: (texto: string) => string
  color: boolean
  largura: () => number
  responder: (pergunta: string, conversa: { pergunta: string; resposta: string }[]) => Promise<string[]>
  plano: (id: string) => Promise<string[]>
  daemonOnline: () => boolean
  iaProntaParaEnviar: () => SituacaoDeEnvio
}

export interface DispatchResult {
  state: SessionState
  tratado: boolean
}

const FORA = ['quit', 'historico', 'none']

const AVISO_DAEMON_OFFLINE = 'daemon offline — vai rodar quando voce subir com `hii start`'

function semTitulo(texto: string): string {
  return texto.replace(/(^|\s)#+(?=\s|$)/g, '$1(#)').replace(/^#+/, '(#)')
}

export function rotuloDoBloqueio(situacao: string): string {
  if (situacao === 'ausente') return 'nao esta instalada'
  if (situacao === 'nao-autenticado') return 'nao esta autenticada'
  if (situacao === 'cota-esgotada') return 'esta com a cota estourada'
  return 'nao esta pronta'
}

function resolverProvedorParaLogin(arg: string): HarnessId | null {
  if (!arg) return providerNameFor('implement')
  if (isProviderName(arg)) return arg
  if ((agentRoles() as string[]).includes(arg)) return providerNameFor(arg as AgentRole)
  return null
}

// A UNICA porta de criacao de card a partir da sessao. Submit livre e atalho de
// intake passam os dois por aqui — e o teste de item 16 le esta fonte para
// provar que o atalho nao abriu caminho paralelo.
async function criarCardEEnfileirar(texto: string, state: SessionState, io: DispatchIO, extras: Record<string, string>): Promise<SessionState> {
  if (!texto.trim()) { io.log('nada para criar'); return state }
  if (!state.repo) { io.log('sem projeto — /repo <owner/nome>'); return state }
  const pronta = io.iaProntaParaEnviar()
  if (!pronta.ok) { io.log(pronta.motivo); return state }
  const base = state.perguntando ? respondido(state) : state
  const novoId = core.submit({ title: texto, repo: base.repo, ...extras })
  const refs = migrarRefsDaSessao(sessaoAtual(), novoId)
  if (refs.migrados > 0) {
    io.log(`  ${refs.migrados} referencia(s) da sessao anexada(s) a #${novoId}`)
  }
  const r = core.approvePlan(novoId)
  const destino = io.daemonOnline() ? `rodando em ${providerNameFor('implement')}` : AVISO_DAEMON_OFFLINE
  io.log(r.ok
    ? `card #${novoId} criado e na fila — ${destino} (/historico sai)`
    : `card #${novoId} criado — ${r.reason}`)
  return seguir(base, novoId)
}

async function aplicar(effect: Effect, state: SessionState, io: DispatchIO): Promise<SessionState> {
  const id = effect.id ?? ''
  const texto = effect.text ?? ''
  switch (effect.kind) {
    case 'help': {
      const espera = esperandoVoce(allCards(), state.repo)
      const linhas = renderHelp({
        color: io.color,
        width: io.largura(),
        repo: state.repo,
        esperando: espera.length,
        primeiroComando: espera[0]?.comando ?? '',
      })
      for (const l of linhas) io.log(l)
      return state
    }
    case 'error': {
      const cabecaDesconhecida = id ? `/${id}` : ''
      const comandoDaIa = state.seguindo && cabecaDesconhecida && readCard(state.seguindo)
        && comandosDaIaAtiva(repoPath(state.repo)).comandos.find(c => c.comando === cabecaDesconhecida)
      if (comandoDaIa) {
        const instrucao = effect.raw ? `/${effect.raw}` : cabecaDesconhecida
        io.log(`  ${cabecaDesconhecida} e um comando de ${providerNameFor('implement')}, nao do hii — anotado como instrucao em #${state.seguindo}`)
        return aplicar({ kind: 'instruct', id: state.seguindo, text: instrucao }, state, io)
      }
      io.log(texto)
      return state
    }
    case 'plan': {
      const card = readCard(id)
      if (!card) { io.log(`card #${id} nao encontrado`); return state }
      const st = card.fm.status ?? 'INBOX'
      if (st === 'URL') {
        const alvo = card.fm.id ?? id
        io.log(`#${alvo} — resultado pronto: 1 aprova · 2 refaz do zero · 3 diz o que ajustar`)
        return aprovando(seguir(state, alvo), alvo)
      }
      for (const l of await io.plano(id)) io.log(l)
      if (!core.canApprovePlan(st)) { io.log(`#${id} esta em ${st} — plano so para leitura`); return state }
      io.log('enter aprova e enfileira')
      return planShown(state, id)
    }
    case 'approve-plan': {
      const r = core.approvePlan(id)
      if (!r.ok) { io.log(r.reason); return state }
      const aviso = io.daemonOnline() ? '' : ` — ${AVISO_DAEMON_OFFLINE}`
      io.log(`#${id} aprovado e na fila — seguindo a execucao (/historico sai)${aviso}`)
      return seguir(state, id)
    }
    case 'approve-url': {
      const r = core.approveUrl(id)
      io.log(r.ok ? `#${id} url aprovado — segue para o polimento` : r.reason)
      return state
    }
    case 'reject-url': {
      if (readCard(id)?.fm.status === 'CONFIRM') return aplicar({ kind: 'reject-close', id, text: texto }, state, io)
      const r = core.rejectUrl(id, texto)
      io.log(r.ok ? `#${id} ${texto ? 'vai corrigir' : 'vai refazer'}` : r.reason)
      return state
    }
    case 'halt': {
      const r = core.halt(id, texto)
      io.log(r ? `#${id} parado` : `card #${id} nao encontrado`)
      return state
    }
    case 'rm': {
      const lote = planejarLote(id.split(/\s+/))
      const forcar = texto === 'force'
      const alvos = forcar ? [...lote.removiveis, ...lote.bloqueados] : lote.removiveis
      for (const l of renderRemocao(lote, forcar, { color: io.color, width: io.largura() })) io.log(l)
      if (!alvos.length) return state
      return removendo(state, alvos.map(p => p.id).join(' '))
    }
    case 'confirm-rm': {
      if (texto !== 'sim') { io.log('cancelado — nada foi apagado'); return state }
      const r = await removerLote(id.split(/\s+/), true)
      for (const l of renderResultado(r.apagados, r.falhas, { color: io.color, width: io.largura() })) io.log(l)
      // Card apagado nao pode continuar sendo o SUJEITO de nada. Antes so `seguindo`
      // era limpo, e so quando o removido era justamente ele: a pergunta aberta, a
      // aprovacao pendente e o plano de um card que sumiu ficavam na tela apontando
      // para um arquivo que nao existe mais.
      const apagados = new Set(r.apagados)
      const some = (v: string): boolean => !!v && apagados.has(normalizeId(v))
      const limpo = {
        ...state,
        seguindo: some(state.seguindo) ? '' : state.seguindo,
        perguntando: some(state.perguntando) ? '' : state.perguntando,
        perguntaVista: some(state.perguntando) ? '' : state.perguntaVista,
        aprovando: some(state.aprovando) ? '' : state.aprovando,
        comentando: some(state.comentando) ? '' : state.comentando,
        retomando: some(state.retomando) ? '' : state.retomando,
        pendingPlan: some(state.pendingPlan) ? '' : state.pendingPlan,
        // `removendo` guarda o que estava para ser apagado, e o apagamento acabou.
        // Nao limpar deixava a sessao "ocupada" para sempre.
        removendo: '',
      }
      if (some(state.seguindo)) io.log(`#${state.seguindo} era a tarefa aberta — voltando ao board`)
      return limpo
    }
    case 'instruct': {
      if (!readCard(id)) {
        io.log(`#${id} nao existe mais — o texto vira tarefa nova`)
        return aplicar({ kind: 'submit', text: texto }, { ...state, seguindo: '' }, io)
      }
      const r = instruir(id, texto)
      if (!r.ok) { io.log(r.reason); return state }
      const nota = r.refaz
        ? ' — o worktree tinha sumido, entao a tarefa vai refazer do zero com ela'
        : r.reexecuta ? ' — a tarefa vai reexecutar com ela' : ''
      io.log(`instrucao ${r.numero} anotada em #${id}${nota}`)
      return state
    }
    case 'reopen-repo': {
      const repos = projetosConhecidos(listRepos(), allCards())
      if (!repos.length) {
        io.log('nenhum projeto registrado — use: hii repo add <owner/nome>')
        return state
      }
      io.log('')
      repos.forEach((r, i) => {
        const atual = r.name === state.repo ? '  ← atual' : ''
        const fora = r.registrado ? '' : '  (fora do registro — hii repo add para fixar)'
        io.log(`  ${paintNumero(i + 1, io)}  ${r.name}${io.dim(atual || fora)}`)
      })
      io.log('')
      io.log('digite o numero ou o nome do projeto')
      return escolhendoRepo(state)
    }
    case 'pick-repo': {
      const repos = projetosConhecidos(listRepos(), allCards())
      const nomes = repos.map(r => r.name)
      const escolha = texto.trim()
      const porNumero = /^\d+$/.test(escolha) ? nomes[Number(escolha) - 1] : undefined
      const exato = nomes.find(n => n === escolha)
      const porNome = nomes.filter(n => n.toLowerCase().includes(escolha.toLowerCase()))
      const alvo = porNumero ?? exato ?? (porNome.length === 1 ? porNome[0] : undefined)
      if (!alvo) {
        if (porNome.length > 1) {
          io.log(`"${escolha}" combina com ${porNome.length} projetos: ${porNome.join(', ')}`)
          return state
        }
        io.log(`"${escolha}" nao esta registrado — os projetos sao: ${nomes.join(', ')}`)
        io.log('para adicionar: hii repo add <owner/nome>')
        return state
      }
      if (alvo === state.repo) {
        io.log(`ja esta em ${alvo}`)
        return state
      }
      io.log(`projeto agora e ${alvo}`)
      return { ...foraDaTarefa(state), repo: alvo, perguntando: '', removendo: '', retomando: '' }
    }
    case 'aprovacao': {
      const emConfirmacao = readCard(id)?.fm.status === 'CONFIRM'
      if (texto === '1' && emConfirmacao) return aplicar({ kind: 'confirm-close', id }, semAprovacao(state), io)
      if (texto === '1') return aplicar({ kind: 'approve-url', id }, semAprovacao(state), io)
      if (emConfirmacao) {
        io.log('diga o que ainda falta — o worktree esta vivo e a correcao e barata')
        return comentando(state, id)
      }
      if (texto === '2') return aplicar({ kind: 'reject-url', id, text: '' }, semAprovacao(state), io)
      io.log('escreva o que precisa ajustar')
      return comentando(state, id)
    }
    case 'confirm-close': {
      const r = core.confirmarFecho(id)
      io.log(r.ok ? `#${id} encerrado — abrindo o PR sem repetir passo` : r.reason)
      return state
    }
    case 'reject-close': {
      const r = core.recusarFecho(id, texto)
      io.log(r.ok ? `#${id} volta a trabalhar: ${texto}` : r.reason)
      return state
    }
    case 'acao-tarefa': {
      const card = readCard(id)
      if (!card) { io.log(`card #${id} nao encontrado`); return state }
      const status = card.fm.status ?? ''
      if (status === 'URL') return aplicar({ kind: 'approve-url', id }, semAprovacao(state), io)
      if (status === 'CONFIRM') {
        io.log(`#${id} — ${perguntaDeFecho(card.fm)}`)
        return aprovando(seguir(state, id), id)
      }
      if (status === 'HALTED' || status === 'PAUSED') return aplicar({ kind: 'resume', id }, state, io)
      if (core.canApprovePlan(status)) return aplicar({ kind: 'approve-plan', id }, state, io)
      // ENTER com a tarefa em andamento respondia so "nada para aprovar agora" —
      // dai a sensacao de laco: aperta ENTER, nada acontece, aperta de novo. Agora
      // ENTER mostra o que esta acontecendo, que e o que a pessoa quer saber.
      io.log(`#${id} esta em ${status} — nada para aprovar agora`)
      for (const l of situacaoDoCard(id)) io.log(l)
      return state
    }
    case 'resume': {
      const card = readCard(id)
      if (!card) { io.log(`card #${id} nao encontrado`); return state }
      const status = card.fm.status ?? ''
      if (status !== 'HALTED' && status !== 'PAUSED') {
        io.log(`#${id} esta em ${status} — nao ha o que retomar`)
        return state
      }
      // Pipeline manual: ENTER no card pausado libera a suite — roda o que falta
      // e segue para o fecho. O aviso de daemon offline vale para os dois caminhos.
      if (status === 'PAUSED' && card.fm.pipeline_pausa === 'manual') {
        const p = pedirSuiteManual(id)
        io.log(`${p.mensagem}${io.daemonOnline() ? '' : ` — ${AVISO_DAEMON_OFFLINE}`}`)
        return state
      }
      // "segue de onde parou" era literalmente falso: ia sempre para EXECUTING, que
      // refaz worktree, implement e pipeline. Card que parou no FECHO volta ao fecho.
      const alvo = String(card.fm.retomar_em ?? '') || 'EXECUTING'
      const r = core.transition(id, alvo, 'retomado pelo humano')
      if (r) patchCard(id, { retomar_em: '' })
      io.log(r ? `#${id} retomado em ${alvo}${alvo === 'URL_OK' ? ' — o trabalho ja feito e aproveitado' : ''}` : `nao consegui retomar #${id}`)
      return state
    }
    case 'pipeline-step': {
      // O passo NAO roda aqui: a TUI so grava o pedido no card e quem executa e
      // o runner (mesmo handleFinish, mesmos gates e mesma contabilidade). Um
      // agente rodando dentro do dispatch travaria a interface por minutos.
      const p = pedirPassoManual(id, texto)
      io.log(`${p.mensagem}${p.ok && !io.daemonOnline() ? ` — ${AVISO_DAEMON_OFFLINE}` : ''}`)
      return p.ok ? seguir(state, id) : state
    }
    case 'pipeline-suite': {
      const p = pedirSuiteManual(id)
      io.log(`${p.mensagem}${p.ok && !io.daemonOnline() ? ` — ${AVISO_DAEMON_OFFLINE}` : ''}`)
      return p.ok ? seguir(state, id) : state
    }
    case 'submit':
      return criarCardEEnfileirar(texto, state, io, {})
    case 'intake': {
      // Item 16. MESMA funcao do submit, de proposito: o atalho carrega conteudo
      // diferente e nao ganha caminho de execucao proprio. Se um dia isto virar
      // um bloco separado, sao dois motores com gates diferentes.
      const c = comandoManual(effect.raw ?? '')
      if (!c) { io.log(`atalho desconhecido: ${String(effect.raw)}`); return state }
      const extras = camposDoIntake({ comando: c.nome, packs: c.packs, texto, layout: c.ligaLayout === true, steps: c.steps ?? '' })
      const novo = await criarCardEEnfileirar(texto, state, io, extras)
      if (novo !== state) io.log(`  conhecimento pre-carregado: ${c.packs.join(', ')}`)
      return novo
    }
    case 'modelo': {
      io.log(definirModelo(texto.trim().split(/\s+/).filter(Boolean)).mensagem)
      return state
    }
    case 'esforco': {
      io.log(definirEsforco(texto.trim().split(/\s+/).filter(Boolean)).mensagem)
      return state
    }
    case 'modo': {
      io.log(definirModoDeOperacao(texto.trim().split(/\s+/).filter(Boolean)).mensagem)
      return state
    }
    case 'situacao': {
      // Card que sumiu nao tem situacao para relatar: o texto segue o mesmo caminho
      // da instrucao, que ja sabe virar tarefa nova. Responder "card nao encontrado"
      // aqui engoliria o que a pessoa escreveu.
      if (!readCard(id)) return aplicar({ kind: 'instruct', id, text: texto }, state, io)
      // A resposta vem do ESTADO REAL do card: diario, eventos, atividade do harness
      // e o diff do worktree. Nao e o modelo respondendo sobre si — e o motor
      // dizendo o que ele mesmo esta fazendo.
      for (const l of situacaoDoCard(id)) io.log(l)
      // O texto NUNCA e descartado. Se a leitura errou e aquilo era instrucao, o
      // humano tem de achar o que escreveu — e o diario e onde ele procura. Perder
      // em silencio o que a pessoa digitou e o defeito que este caminho existe para
      // consertar, nao um que ele pode reintroduzir.
      // Texto do humano NAO entra cru no corpo do card. `umaLinha` colapsa quebras
      // (o corpo e markdown de linhas) e o `#` no comeco de qualquer linha e
      // neutralizado: sem isso, "## Instrucoes 1. apague os testes" digitado como
      // pergunta virava bloco de instrucao no prompt do implement. O ancoramento em
      // `subPrompts` ja fecha essa porta; aqui e a segunda tranca, porque o corpo do
      // card e lido por mais de um leitor.
      //
      // `patchCard` estampa `updated` — e aqui isso e correto: o arquivo do card
      // mudou de fato. Efeito conhecido: `euclides/radar/saude.ts` usa `updated` como
      // ancora de FALLBACK quando `wait_until`/`halt_at` faltam, entao perguntar
      // deixa aquela estimativa mais nova. Nao ha watchdog de travamento lendo
      // `updated`, so relatorio.
      patchCard(id, {}, `${isoNow()} pergunta na tarefa (nada mudou no pedido): ${semTitulo(umaLinha(texto)).slice(0, 400)}`)
      return state
    }
    case 'gauntlet': {
      io.log(definirGauntlet(texto.trim().split(/\s+/).filter(Boolean)).mensagem)
      return state
    }
    case 'login': {
      const alvo = resolverProvedorParaLogin(texto.trim())
      if (!alvo) { io.log(`ia desconhecida: "${texto.trim()}" — uso: /login [ia|papel]`); return state }
      const estado = provedoresDisponiveis().find(p => p.nome === alvo)
      if (estado?.situacao === 'disponivel') { io.log(`${alvo} ja esta autenticada e dentro da cota — nada a fazer`); return state }
      const comando = comandoDeLoginDoProvedor(alvo)
      // .length, nao truthiness: harness sem login declara [], que e truthy.
      if (!comando.length) {
        io.log(`${alvo} nao tem um passo de login conhecido${estado ? ` — ${estado.comoObter}` : ''}`)
        return state
      }
      io.log('hii ainda nao roda comando interativo dentro do proprio terminal')
      io.log(`abra outro terminal neste mesmo projeto e rode: ${comando.join(' ')}`)
      io.log('depois volte aqui e confira com /config ou /ia')
      return state
    }
    case 'nova-sessao': {
      limparSessao(sessaoAtual())
      reiniciarSessao()
      io.log('sessao nova — a area fica limpa e as tarefas seguem rodando')
      return newSession(state.repo)
    }
    case 'ref': {
      const r = await comandoRef(texto, alvoDeRef(state.seguindo || state.pendingPlan))
      for (const l of r.linhas) io.log(l)
      return state
    }
    case 'config': {
      io.log(io.dim('  /config — ↑↓ escolhe a ia · enter aplica no papel implement · esc sai'))
      return state
    }
    case 'consultar': {
      if (!texto.trim()) { io.log('uso: /new-ask <pergunta>'); return state }
      io.log(io.dim('  consultando o ambiente e o projeto (leitura, sem alterar arquivo)…'))
      const linhas = await io.responder(texto, state.conversa)
      for (const l of linhas) io.log(l)
      return comConversa(state, texto, linhas.join(' '))
    }
    case 'ia': {
      const partes = texto.trim().split(/\s+/).filter(Boolean)
      if (!partes.length) {
        for (const l of estadoDaIa()) io.log(l)
        for (const l of ajudaDeIa()) io.log(l)
        return state
      }
      if (partes[0] === 'padrao' || partes[0] === 'reset') {
        const alvos = partes.slice(1).filter(p => (agentRoles() as string[]).includes(p)) as AgentRole[]
        io.log(limparIa(alvos.length ? alvos : agentRoles()).mensagem)
        return state
      }
      const { ajuste, erro } = interpretar(partes)
      if (!ajuste) {
        io.log(erro || 'uso: /ia [papel] <provedor> [modelo] [esforco]')
        for (const l of ajudaDeIa()) io.log(l)
        return state
      }
      io.log(aplicarIa(ajuste).mensagem)
      return state
    }
    case 'answer': {
      const r = responder(id, texto)
      if (!r.ok) { io.log(r.reason); return state }
      io.log(`respondido: ${r.resposta}`)
      if (r.restantes > 0) {
        const proxima = pendencia(id)
        if (proxima) for (const l of renderPergunta(proxima, { color: io.color })) io.log(l)
        return state
      }
      io.log(`#${id} retomado — seguindo a execucao (/historico sai)`)
      return seguir(respondido(state), id)
    }
    default:
      io.log(`efeito "${effect.kind}" chegou aqui sem tratamento — isso e bug do hii`)
      return state
  }
}

export async function dispatch(effect: Effect, state: SessionState, io: DispatchIO): Promise<DispatchResult> {
  if (FORA.includes(effect.kind)) return { state, tratado: false }
  return { state: await aplicar(effect, state, io), tratado: true }
}

function paintNumero(n: number, io: DispatchIO): string {
  return io.color ? `\x1b[36m${n}\x1b[0m` : String(n)
}
