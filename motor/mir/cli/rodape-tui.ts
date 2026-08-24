import { readCard } from '../../cdl/store.ts'
import { dailySpend } from '../../euc/tsr/lacuna.ts'
import type { DailySpend } from '../../euc/tsr/lacuna.ts'
import { effortFor, modelFor, providerNameFor } from '../../tmd/registro.ts'
import { modoFor } from '../../tmd/registro.ts'
import { modoResolvido } from '../../tmd/modos.ts'
import { emExecucao, esperandoEmOutrosProjetos, esperandoVoce, linhaDeOutrosProjetos, linhaPropriedades, linhasEspera, linhasExecucao } from '../render/rodape.ts'
import { ESFORCO_PADRAO, gauntletLigado } from '../../tmd/preferencias.ts'
import { usoDeDiscoCacheado } from '../../euc/estado-em-disco.ts'
import { cardsPerguntando } from '../responder.ts'
import { ultimoAgente } from '../atividade.ts'
import type { SessionState } from '../sessao.ts'
import type { CorpoContexto } from '../tui/app.ts'
import { ACC, DIM, RESET, color } from './saida.ts'
import { atividadeDe, todosOsCards } from './dados.ts'
import { selecionado } from './estado.ts'

export function custoDoDia(repo: string): DailySpend {
  const hoje = new Date().toISOString().slice(0, 10)
  return dailySpend(todosOsCards().filter(c => !repo || c.repo === repo), hoje)
}

export function esforcoAtual(state: SessionState): string {
  const alvo = state.seguindo || state.pendingPlan
  const doCard = alvo ? readCard(alvo)?.fm.effort : undefined
  return effortFor('implement', doCard) ?? ESFORCO_PADRAO
}

export function papeisDivergentes(): string[] {
  const base = providerNameFor('implement')
  return (['step', 'gate', 'verify'] as const)
    .filter(p => providerNameFor(p) !== base)
    .map(p => `${p}: ${providerNameFor(p)}`)
}

export function rodapeDa(state: SessionState, noRodape = false): string[] {
  const largura = Number(process.stdout.columns) || 80
  const gasto = custoDoDia(state.repo)
  const props = linhaPropriedades({
    provedor: providerNameFor('implement'),
    modelo: modelFor('implement') ?? '',
    effort: esforcoAtual(state),
    // Modo EFETIVO, nao o escolhido: `modoFor` devolve undefined quando o operador
    // nao escolheu, e o rodape omitia o campo — o humano nao via em que modo a ia
    // ia rodar, que e justamente o que muda se ela pede aprovacao ou nao.
    modo: modoResolvido(providerNameFor('implement'), modoFor('implement')),
    projeto: state.repo,
    custoHoje: gasto.total,
    pisoDoGasto: gasto.floor,
    divergentes: papeisDivergentes(),
    disco: usoDeDiscoCacheado(),
    gauntlet: gauntletLigado(),
  }, { color, width: largura })
  const cards = todosOsCards()
  const rodando = emExecucao(cards, state.repo, Date.now(), id => ultimoAgente(atividadeDe(id)))
  const marcado = {
    color, now: Date.now(), width: largura,
    selecionado: noRodape ? selecionado() : '',
    maxLinhas: noRodape ? 6 : 3,
  }
  const espera = linhasEspera(esperandoVoce(cards, state.repo), marcado)
  const fora = linhaDeOutrosProjetos(esperandoEmOutrosProjetos(cards, state.repo), marcado)
  return [props, ...linhasExecucao(rodando, marcado), ...espera, ...fora]
}

export function pintarComando(linha: string): string {
  if (!color || !linha.startsWith('/')) return linha
  const m = linha.match(/^(\/[a-zA-Z-]*)(.*)$/s)
  if (!m) return linha
  const [, comando, resto] = m
  return `${ACC}${comando}${RESET}${resto ?? ''}`
}

export function dicaDa(state: SessionState, sugerindo = false): string {
  const texto = ((): string => {
    if (sugerindo) return '↑/↓ escolhe · tab completa · enter usa'
    if (selecionado()) return '↑/↓ move · enter entra · esc sai'
    if (state.comentando) return 'escreva o ajuste · enter vazio desiste'
    if (state.aprovando) return '↑/↓ escolhe · 1 aprova · 2 refaz · 3 comenta'
    if (state.escolhendo) return 'numero ou nome do projeto · enter desiste'
    if (state.retomando) return 'enter retoma de onde parou · ctrl+c sai do hii'
    if (state.removendo) return 'enter confirma · n cancela'
    if (state.perguntando) return '↑/↓ escolhe · numero responde · enter confirma'
    if (state.seguindo) return 'escreva para instruir · /board volta'
    const aqui = cardsPerguntando(todosOsCards(), state.repo)
    if (aqui.length) return `#${aqui[0]} espera resposta · /ask responde`
    const noutro = cardsPerguntando(todosOsCards())
    if (noutro.length) return `#${noutro[0]} espera resposta em outro projeto · /ask ${Number(noutro[0])}`
    return 'shift+tab cicla o modo da ia · ctrl+j quebra linha · /help para tudo'
  })()
  return color ? `${DIM}${texto}${RESET}` : texto
}

export function dicaDaNavegacao(ctx: CorpoContexto, state: SessionState): string {
  if (state.tela === 'config') return '↑↓ escolhe a ia · enter aplica no papel implement · esc sai'
  if (ctx.navegando === 'board') return '↑↓ escolhe a sessao · enter abre a tarefa · ← ou → volta'
  if (ctx.navegando) return '↑↓ move · enter abre · → volta · ← sessoes'
  return dicaDa(state, ctx.sugerindo)
}
