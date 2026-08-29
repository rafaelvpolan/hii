import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readCard, repoPath } from '../../cordel/store.ts'
import { hasDevServer } from '../../ciclo/crivo/url-viva.ts'
import { buildPlan } from '../../niemeyer/lucio/plano.ts'
import { renderPlan } from '../render/plan.ts'
import { renderCabecalhoTarefa } from '../render/tarefa.ts'
import { renderProcessos } from '../render/processos.ts'
import { temPerguntaAberta } from '../../ciclo/crivo/perguntas-do-crivo.ts'
import { renderPendencia } from '../render/pendencia.ts'
import { idadeDe } from '../render/board.ts'
import { readRunSteps } from '../../euclides/registros.ts'
import { extractObjetivo } from '../../cordel/index.ts'
import { subPrompts } from '../instruir.ts'
import { formatar, ultimaAcao, ultimoAgente } from '../atividade.ts'
import type { SessionState } from '../sessao.ts'
import { color } from './saida.ts'
import { atividadeDe, passosDe } from './dados.ts'
import { renderSituacao } from '../render/situacao.ts'
import { eventosDoCard } from '../../euclides/eventos.ts'

export function planoDe(id: string): string {
  const card = readCard(id)
  if (!card) return ''
  const alvo = repoPath(card.fm.repo ?? '')
  // `existeNoAlvo` fecha o falso positivo de PROSA: "esta sendo feito/executado em
  // ..." tem barra e casa a forma de caminho. Sem esta checagem o plano mostraria
  // "feito/executado" como se fosse arquivo — e o plano e o que o humano aprova.
  //
  // A raiz e a MESMA que o motor usa (`escopoDoCard(card, wt)`): quando o worktree
  // ja existe, e ele. Conferir contra o clone principal enquanto o motor confere
  // contra o worktree fazia o plano prometer um escopo que a execucao nao aplicava
  // — build output gitignorado presente no clone e ausente no worktree novo
  // aparecia como "so le" no plano e sumia na hora de valer.
  const wt = String(card.fm.worktree ?? '')
  const raiz = wt && existsSync(wt) ? wt : alvo
  const plano = buildPlan({
    card,
    hasDevServer: existsSync(alvo) && hasDevServer(alvo),
    existeNoAlvo: (caminho) => existsSync(join(raiz, caminho)),
  })
  return renderPlan(plano, { color })
}

export function cabecalhoDaTarefa(state: SessionState): string[] {
  const card = readCard(state.seguindo)
  if (!card) return [`card #${state.seguindo} nao encontrado`]
  const cab = renderCabecalhoTarefa(card, {
    color,
    width: Math.max(40, (Number(process.stdout.columns) || 78) - 6),
    objetivo: extractObjetivo(card.body) || String(card.fm.title ?? ''),
    subs: subPrompts(card.body),
  })
  const status = String(card.fm.status ?? '')
  const pend = renderPendencia(status, state.seguindo, {
    temPerguntaDoCrivo: temPerguntaAberta(card.fm, state.seguindo),
    color,
    width: Math.max(40, (Number(process.stdout.columns) || 78) - 6),
    detalhe: status === 'PR_OPEN' ? String(card.fm.pr_url ?? '') : '',
  })
  const passos = passosDe(card.fm)
  const at = atividadeDe(state.seguindo)
  // Sem passos NAO e sem informacao: o perfil `visual` roda zero passo de pipeline,
  // e era exatamente o card do incidente. Um early return aqui esconderia o painel
  // do motor justamente na tarefa rapida — onde acompanhar importa mais, porque
  // acaba antes. Sem renderProcessos, `agentes` e `ultima acao` voltam ao painel:
  // ninguem mais os mostra.
  const processos = !passos.length ? [] : renderProcessos(passos, {
    color,
    width: Math.max(40, (Number(process.stdout.columns) || 78) - 6),
    metricas: readRunSteps(state.seguindo) ?? {},
    agente: ultimoAgente(at),
    ferramenta: ultimaAcao(at),
    desde: idadeDe(card.fm.updated, Date.now()),
    parado: ['HALTED', 'PAUSED', 'CLARIFY'].includes(status),
  })
  // A queixa era: a area de execucao mostrava o que a IA fazia (Read, Edit, Task) e
  // nada do que o MOTOR decidia. Estas linhas ficam FIXADAS (repl.ts passa este
  // cabecalho como `fixo`), entao nao rolam para fora com o feed.
  const doMotor = renderSituacao({
    fm: card.fm,
    eventos: eventosDoCard(state.seguindo),
    atividades: at,
    tocados: [],
  }, {
    color,
    width: Math.max(40, (Number(process.stdout.columns) || 78) - 6),
    // `agentes` e `ultima acao` ja estao no renderProcessos acima.
    omitir: passos.length ? ['agentes', 'ultima acao'] : [],
    cabecalho: false,
  })
  // `doMotor` vem ANTES de `processos`: renderFrame corta o pinado pelo FIM
  // (tui/layout.ts), e num terminal baixo o que tem de sobreviver e a decisao do
  // motor (perfil, escopo, fase, gate, gasto), nao a lista de passos.
  return [...cab, ...pend, ...doMotor, ...processos, '']
}

export function seguimento(state: SessionState): string[] {
  const card = readCard(state.seguindo)
  const at = atividadeDe(state.seguindo)
  if (at.length) return at.slice(-200).map(formatar)
  const status = String(card?.fm.status ?? '')
  if (['EXECUTING', 'CORRECTING'].includes(status)) return ['  aguardando a IA…']
  if (status === 'HALTED') return ['  tarefa parada — escreva uma instrucao ou aperte enter para retomar']
  if (status === 'CLARIFY') return ['  esperando a sua resposta abaixo']
  return ['  nada em execucao nesta tarefa']
}
