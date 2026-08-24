import { comandoManual, camposDoIntake } from './comandos-manuais.ts'
import { readCard, allCards, normalizeId, listRepos, repoPath } from '../cdl/store.ts'
import * as core from './acoes.ts'
import { planejarLote, removerLote } from '../cdl/remover.ts'
import { renderRemocao, renderResultado } from './render/remocao.ts'
import { projetosConhecidos } from '../cdl/projetos-conhecidos.ts'
import { interpretar, aplicar as aplicarIa, limpar as limparIa, ajuda as ajudaDeIa, estadoDaIa, definirModelo, definirEsforco, definirModoDeOperacao } from './escolher-ia.ts'
import { agentRoles, isProviderName, providerNameFor } from '../tmd/registro.ts'
import { comandoDeLoginDoProvedor, provedoresDisponiveis } from '../tmd/disponibilidade.ts'
import { comandosDaIaAtiva } from '../tmd/map/comandos.ts'
import type { AgentRole, HarnessId } from '../tmd/tipos.ts'
import { pendencia, responder } from './responder.ts'
import { renderPergunta } from './render/clarify.ts'
import { instruir } from './instruir.ts'
import { renderHelp } from './render/help.ts'
import { esperandoVoce } from './render/rodape.ts'
import { newSession, seguir, foraDaTarefa, planShown, removendo, respondido, escolhendoRepo, aprovando, comentando, semAprovacao, comConversa } from './sessao.ts'
import { alvoDeRef, comandoRef } from './refs-comando.ts'
import { migrarRefsDaSessao, limparSessao } from '../qlb/alf/anexo.ts'
import { reiniciarSessao, sessaoAtual } from '../euc/sessao.ts'
import type { Effect, SessionState } from './sessao.ts'

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

export function rotuloDoBloqueio(situacao: string): string {
  if (situacao === 'ausente') return 'nao esta instalada'
  if (situacao === 'nao-autenticado') return 'nao esta autenticada'
  if (situacao === 'cota-esgotada') return 'esta com a cota estourada'
  return 'nao esta pronta'
}

function resolverProvedorParaLogin(arg: string): HarnessId | null {
  if (!arg) return providerNameFor('implement')
  if (arg !== undefined && isProviderName(arg)) return arg
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
      if (state.seguindo && r.apagados.includes(normalizeId(state.seguindo))) {
        io.log(`#${state.seguindo} era a tarefa aberta — voltando ao board`)
        return { ...state, seguindo: '', perguntando: '' }
      }
      return state
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
      if (texto === '1') return aplicar({ kind: 'approve-url', id }, semAprovacao(state), io)
      if (texto === '2') return aplicar({ kind: 'reject-url', id, text: '' }, semAprovacao(state), io)
      io.log('escreva o que precisa ajustar')
      return comentando(state, id)
    }
    case 'acao-tarefa': {
      const card = readCard(id)
      if (!card) { io.log(`card #${id} nao encontrado`); return state }
      const status = card.fm.status ?? ''
      if (status === 'URL') return aplicar({ kind: 'approve-url', id }, semAprovacao(state), io)
      if (status === 'HALTED' || status === 'PAUSED') return aplicar({ kind: 'resume', id }, state, io)
      if (core.canApprovePlan(status)) return aplicar({ kind: 'approve-plan', id }, state, io)
      io.log(`#${id} esta em ${status} — nada para aprovar agora`)
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
      const r = core.transition(id, 'EXECUTING', 'retomado pelo humano')
      io.log(r ? `#${id} retomado — segue de onde parou` : `nao consegui retomar #${id}`)
      return state
    }
    case 'submit':
      return criarCardEEnfileirar(texto, state, io, {})
    case 'intake': {
      // Item 16. MESMA funcao do submit, de proposito: o atalho carrega conteudo
      // diferente e nao ganha caminho de execucao proprio. Se um dia isto virar
      // um bloco separado, sao dois motores com gates diferentes.
      const c = comandoManual(effect.raw ?? '')
      if (!c) { io.log(`atalho desconhecido: ${String(effect.raw)}`); return state }
      const extras = camposDoIntake({ comando: c.nome, packs: c.packs, texto, layout: c.ligaLayout === true })
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
