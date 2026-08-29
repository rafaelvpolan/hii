import { existsSync } from 'node:fs'
import { reposFile } from '../../cordel/alicerce/config.ts'
import { repoPath, repoRegistered } from '../../cordel/store.ts'
import { chaveDaSessao, historicoDeSessoes, repoDoCard, sessaoPorChave } from '../historico.ts'
import { avisoDeEstadoVazio, lerEstadoVazio } from '../estado-vazio.ts'
import { renderHistorico } from '../render/historico.ts'
import { renderConfig } from '../render/config/index.ts'
import { seguimento } from './tela-tarefa.ts'
import { emExecucao, esperandoVoce } from '../render/rodape.ts'
import { pendencia } from '../responder.ts'
import { complete } from '../completar.ts'
import { lerConfig, ordemDaConfig } from '../../cordel/alicerce/snapshot.ts'
import { agentRoles, providerNameFor, providerNames } from '../../tomada/registro.ts'
import { modelosDe } from '../../tomada/catalogo.ts'
import { modosDoProvedor } from '../../tomada/modos.ts'
import { ESFORCOS } from '../../tomada/preferencias.ts'
import { comandosDaIaAtiva } from '../../tomada/mapa/comandos.ts'
import type { SessionState } from '../sessao.ts'
import type { ModoNavegacao } from '../tui/input.ts'
import { color, dim, say } from './saida.ts'
import { larguraUtil, reposRegistrados, todosOsCards } from './dados.ts'
import { definirSessoesVisiveis, selecionado, selecionar, sessoesVisiveis } from './estado.ts'

function pertenceAoRepo(chave: string, repo: string): boolean {
  if (!repo) return true
  const card = cardDaSessao(chave)
  return !!card && repoDoCard(card) === repo
}

export function ordemDasSessoes(repo = ''): string[] {
  const visiveis = sessoesVisiveis().filter(chave => pertenceAoRepo(chave, repo))
  if (visiveis.length) return visiveis
  return historicoDeSessoes(0, undefined, undefined, repo).sessoes.map(chaveDaSessao)
}

export function cardDaSessao(chave: string): string {
  if (!chave) return ''
  return sessaoPorChave(chave, historicoDeSessoes())?.card ?? ''
}

export function ordemDoRodape(state: SessionState, modo: ModoNavegacao = 'rodape'): string[] {
  if (modo === 'board') return ordemDasSessoes(state.repo)
  const cards = todosOsCards()
  const rodando = emExecucao(cards, state.repo, Date.now(), () => '').map(e => e.id)
  const espera = esperandoVoce(cards, state.repo).map(e => e.id)
  const tarefas = [...rodando, ...espera.filter(id => !rodando.includes(id))]
  // As opcoes vem ANTES das tarefas, na MESMA lista, e nao no lugar delas. Devolver
  // so as opcoes fazia a navegacao travar no fim (`navegar` limita no ultimo item):
  // com pergunta aberta nao havia como descer para outra tarefa — a pessoa ficava
  // presa naquele card. Descer alem da ultima opcao agora entra nas tarefas, e subir
  // acima da primeira volta para o prompt, como em qualquer lista daqui.
  if (state.aprovando) return ['op:1', 'op:2', 'op:3', ...tarefas]
  if (state.perguntando) {
    const p = pendencia(state.perguntando)
    if (p) return [...p.atual.options.map((_, i) => `op:${i + 1}`), ...tarefas]
  }
  return tarefas
}

export function navegar(state: SessionState, dir: -1 | 1, modo: ModoNavegacao): boolean {
  const ordem = ordemDoRodape(state, modo)
  if (!ordem.length) return false
  const atual = ordem.indexOf(selecionado())
  const proximo = atual < 0 ? 0 : atual + dir
  if (proximo < 0) { selecionar(''); return false }
  selecionar(ordem[Math.min(proximo, ordem.length - 1)] ?? '')
  return true
}

function avisoDeProjetoSemSessao(repo: string): string[] {
  if (!repo) return []
  return [`nenhuma sessao de ${repo} nesta janela — /repo troca de projeto, o historico dos outros continua intacto`]
}

export function historicoDaTela(altura = 0, repo = ''): string[] {
  const h = historicoDeSessoes(altura > 0 ? Math.max(1, altura - 2) : 0, undefined, undefined, repo)
  definirSessoesVisiveis(h.sessoes.map(chaveDaSessao))
  const vazio = lerEstadoVazio()
  const avisoDeVazio = h.sessoes.length
    ? []
    : (vazio.vazio ? avisoDeEstadoVazio(vazio) : avisoDeProjetoSemSessao(repo))
  return renderHistorico(h, {
    color, width: Number(process.stdout.columns) || 78, selecionado: selecionado(),
    avisoDeVazio,
  })
}

export function avisoRepos(state: SessionState): void {
  const registrados = reposRegistrados()
  if (!registrados.length) {
    say(dim(`  nenhum repo-alvo registrado em ${reposFile()}`))
    say(dim('  copie o modelo e ajuste o `path` para o clone local:'))
    say(dim('    cp config/repos.example.json config/repos.json'))
    return
  }
  if (state.repo && !repoRegistered(state.repo)) {
    say(dim(`  atencao: "${state.repo}" nao esta em ${reposFile()} — o card vai parar em HALTED`))
    return
  }
  const alvo = registrados.find(r => r.name === state.repo)
  const caminho = alvo?.path ?? ''
  if (caminho && !existsSync(caminho)) {
    say(dim(`  atencao: o clone de "${state.repo}" nao existe em ${caminho}`))
  } else if (!caminho && !existsSync(repoPath(state.repo))) {
    say(dim(`  atencao: sem "path" no registro e sem clone irmao em ${repoPath(state.repo)}`))
    say(dim('  o card vai parar em HALTED com "repo nao encontrado"'))
  }
}

export function completer(line: string, repo = ''): [string[], string] {
  const daIa = comandosDaIaAtiva(repo ? repoPath(repo) : '')
  return complete(line, {
    repos: reposRegistrados().map(r => r.name),
    cards: todosOsCards().map(c => String(c.id ?? '')).filter(Boolean),
    provedores: providerNames(),
    modelos: modelosDe(providerNameFor('implement')),
    esforcos: [...ESFORCOS],
    modos: [...modosDoProvedor(providerNameFor('implement'))],
    papeis: agentRoles(),
    comandosDaIa: daIa.comandos.map(c => c.comando),
  })
}

export function navegarConfig(dir: -1 | 1): boolean {
  const ordem = ordemDaConfig()
  if (!ordem.length) return false
  const atual = ordem.indexOf(selecionado())
  const proximo = atual < 0 ? 0 : atual + dir
  if (proximo < 0) { selecionar(''); return false }
  selecionar(ordem[Math.min(proximo, ordem.length - 1)] ?? '')
  return true
}

export interface ContextoDoCorpo {
  navegando: ModoNavegacao
  altura: number
}

export function corpoDaTela(state: SessionState, ctx: ContextoDoCorpo): string[] {
  if (state.tela === 'config') {
    return renderConfig(lerConfig(state.repo, selecionado()), {
      color, largura: larguraUtil(), altura: ctx.altura,
    })
  }
  if (ctx.navegando === 'board') return historicoDaTela(ctx.altura, state.repo)
  return state.seguindo ? seguimento(state) : historicoDaTela(ctx.altura)
}

export type Entrada =
  | { kind: 'nada' }
  | { kind: 'provedor'; nome: string }
  | { kind: 'opcao'; escolha: string }
  | { kind: 'tarefa'; id: string }

export function alvoDeEntrada(modo: ModoNavegacao, state: SessionState): Entrada {
  const escolha = selecionado()
  if (state.tela === 'config') {
    const nomes = providerNames()
    const alvo = (nomes as string[]).includes(escolha) ? escolha : (nomes[0] ?? '')
    return alvo ? { kind: 'provedor', nome: alvo } : { kind: 'nada' }
  }
  if (modo === 'board') {
    const id = cardDaSessao(escolha)
    return id ? { kind: 'tarefa', id } : { kind: 'nada' }
  }
  if (escolha.startsWith('op:')) return { kind: 'opcao', escolha: escolha.slice(3) }
  return escolha ? { kind: 'tarefa', id: escolha } : { kind: 'nada' }
}

export function navegarNaTela(state: SessionState, dir: -1 | 1, modo: ModoNavegacao): boolean {
  if (state.tela === 'config') return navegarConfig(dir)
  return navegar(state, dir, modo)
}
