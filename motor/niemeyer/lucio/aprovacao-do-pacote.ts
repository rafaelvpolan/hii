import { initHicodeHome } from '../../cordel/alicerce/home.ts'
import { providerFor } from '../../tomada/registro.ts'
// Prompt primeiro: nenhuma execucao chama IA antes de o pedinte aprovar o pacote.
// A tarefa para em CLARIFY com a pergunta "aprovar e executar?" no mesmo canal de
// perguntas da TUI e da API. Texto livre vira instrucao adicional e gera pacote novo.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isoNow } from '../../cordel/index.ts'
import type { Card, Fields } from '../../cordel/index.ts'
import type { ClarifyQuestion } from '../../cordel/tipos.ts'
import { patchCard, readCard, repoPath, repoRegistered, updateCardPorAcaoHumana } from '../../cordel/store.ts'
import { cardsDir } from '../../cordel/alicerce/config.ts'
import { anexarSubPrompt } from '../../mirante/instruir.ts'
import { harnessSeExistir } from '../../tomada/registro.ts'
import { campoDaEscolhaHumana, campoDeOverrideDoPapel } from '../../tomada/rota.ts'
import type { AgentRole } from '../../tomada/tipos.ts'
import { motivoParaEsperarHarness } from '../../tomada/harness-em-voo.ts'
import { publicarEvento } from '../../euclides/ponte-eventos.ts'
import { montarPacote, renderizarPacote, resumoDoPacote } from './pacote-de-execucao.ts'
import type { PacoteDeExecucao } from './pacote-de-execucao.ts'

export const RESPOSTA_APROVAR = 'Aprovar e executar'
export const RESPOSTA_CANCELAR = 'Cancelar a tarefa'
export const PAPEIS_COM_IA: readonly AgentRole[] = ['implement', 'verify', 'gate', 'step']
const RETORNOS_DO_PACOTE: readonly string[] = ['INBOX', 'READY', 'PLAN_APPROVED', 'EXECUTING', 'CORRECTING', 'URL_OK', 'REFINED', 'TESTS_GREEN', 'SEC_CLEARED', 'REVIEWED', 'CLEANED']
const ENTREGUES: readonly string[] = ['PR_OPEN', 'MERGED', 'DEPLOYED', 'COMPLETED']

export function promptPrimeiroLigado(): boolean {
  return (process.env.HII_PROMPT_PRIMEIRO || 'on').trim().toLowerCase() !== 'off'
}

export function arquivoDoPacote(id: string): string {
  return join(cardsDir(), 'pacotes', `${id}.md`)
}

function gravarPacote(p: PacoteDeExecucao): string {
  const arquivo = arquivoDoPacote(p.id)
  mkdirSync(join(cardsDir(), 'pacotes'), { recursive: true })
  writeFileSync(arquivo, renderizarPacote(p))
  return arquivo
}

export function execucaoJaIniciada(fm: Fields): boolean {
  return !!fm.worktree || Number(fm.cost_usd || '0') > 0 || Number(fm.tokens_total || '0') > 0
}

function prepararProjetoDaIa(card: Card): void {
  const repo = card.fm.repo ?? ''
  if (!repo || !repoRegistered(repo)) return
  const alvo = repoPath(repo)
  if (!existsSync(alvo)) return
  initHicodeHome(alvo)
  providerFor('implement', card.fm.provider_override_implement || undefined).prepararProjeto?.(alvo)
}

export function liberarPeloPacote(id: string): boolean {
  if (!promptPrimeiroLigado()) return true
  const card = readCard(id)
  if (!card || card.fm.tipo === 'session') return true
  if (!card.fm.pacote_hash && execucaoJaIniciada(card.fm)) return true
  prepararProjetoDaIa(card)
  const pacote = montarPacote(card)
  if (card.fm.pacote_aprovado_hash === pacote.hash) return true
  const arquivo = gravarPacote(pacote)
  const campos: Fields = { status: 'CLARIFY', pacote_hash: pacote.hash, pacote_status: 'aguardando', pacote_retomar_status: card.fm.status === 'CLARIFY' ? card.fm.pacote_retomar_status || 'EXECUTING' : card.fm.status || 'EXECUTING', pacote_arquivo: arquivo, pacote_resumo: resumoDoPacote(pacote) }
  patchCard(id, campos, `${isoNow()} ${card.fm.status}->CLARIFY pacote de execucao ${pacote.hash} pronto para revisao (${arquivo}); nenhuma IA foi chamada`)
  publicarEvento('pausa', id, card.fm.sessao_id ?? '', { mensagem: `pacote de execucao aguardando aprovacao: ${resumoDoPacote(pacote)}` })
  return false
}

export function perguntaDoPacote(fm: Fields): ClarifyQuestion | null {
  if (fm.status !== 'CLARIFY' || fm.pacote_status !== 'aguardando') return null
  return {
    q: `Revise o pacote de execucao antes de rodar. ${fm.pacote_resumo ?? ''}. Prompt completo: ${fm.pacote_arquivo ?? ''}. Aprovar e executar? Para ajustar, responda com a instrucao.`,
    options: [RESPOSTA_APROVAR, RESPOSTA_CANCELAR],
    recommended: RESPOSTA_APROVAR,
  }
}

export interface RespostaDoPacote {
  readonly ok: boolean
  readonly reason: string
  readonly retomou: boolean
}

export function responderPacote(id: string, resposta: string): RespostaDoPacote {
  const card = readCard(id)
  const fm = card?.fm
  if (!card || !fm || !perguntaDoPacote(fm)) return { ok: false, reason: `#${id} nao tem pacote aguardando aprovacao`, retomou: false }
  const origem = fm.pacote_retomar_status ?? 'EXECUTING'
  const retorno = RETORNOS_DO_PACOTE.includes(origem) ? origem : 'EXECUTING'
  const texto = resposta.trim()
  if (texto === RESPOSTA_APROVAR || /^(sim|s|aprovar|aprovo|ok)$/i.test(texto)) {
    const atual = montarPacote(card)
    if (atual.hash !== fm.pacote_hash) {
      const arquivo = gravarPacote(atual)
      patchCard(id, { pacote_hash: atual.hash, pacote_arquivo: arquivo, pacote_resumo: resumoDoPacote(atual), pacote_aprovado_hash: '' })
      return { ok: false, reason: 'O pacote mudou desde a revisao. Revise o novo prompt antes de aprovar.', retomou: false }
    }
    updateCardPorAcaoHumana(id, {
      fields: { status: retorno, pacote_status: 'aprovado', pacote_aprovado_hash: fm.pacote_hash ?? '', pacote_aprovado_em: isoNow() },
      log: `${isoNow()} CLARIFY->${retorno} pacote ${fm.pacote_hash ?? ''} aprovado pelo pedinte`,
    })
    return { ok: true, reason: '', retomou: true }
  }
  if (texto === RESPOSTA_CANCELAR || /^(nao|n|cancelar)$/i.test(texto)) {
    updateCardPorAcaoHumana(id, {
      fields: { status: 'HALTED', halt_class: 'humano', halt_reason: 'pacote de execucao recusado pelo pedinte', halt_at: isoNow(), pacote_status: 'recusado' },
      log: `${isoNow()} CLARIFY->HALTED pacote ${fm.pacote_hash ?? ''} recusado pelo pedinte`,
    })
    return { ok: true, reason: '', retomou: false }
  }
  if (!texto) return { ok: false, reason: 'resposta vazia', retomou: false }
  updateCardPorAcaoHumana(id, {
    fields: { status: retorno, pacote_status: 'ajustado' },
    body: body => anexarSubPrompt(body, texto),
    log: `${isoNow()} CLARIFY->${retorno} pedinte ajustou o pedido; um pacote novo sera montado antes de qualquer IA`,
  })
  return { ok: true, reason: '', retomou: true }
}

export interface EscolhaDeIa {
  readonly papel: string
  readonly provedor: string
  readonly modelo?: string
}

export interface IaDoCard {
  readonly papel: AgentRole
  readonly provedor: string
  readonly modelo: string
}

export function iasDoCard(fm: Fields): IaDoCard[] {
  return PAPEIS_COM_IA.map(papel => ({ papel, provedor: fm[campoDeOverrideDoPapel(papel)] ?? '', modelo: papel === 'implement' ? fm.orq_modelo ?? '' : '' }))
}

export function definirIaDoCard(id: string, e: EscolhaDeIa): { ok: boolean; reason: string } {
  const card = readCard(id)
  if (!card) return { ok: false, reason: `card #${id} nao encontrado` }
  const papel = PAPEIS_COM_IA.find(p => p === e.papel)
  if (!papel) return { ok: false, reason: `papel invalido: ${e.papel} (use ${PAPEIS_COM_IA.join(', ')})` }
  const harness = e.provedor ? harnessSeExistir(e.provedor) : undefined
  if (e.provedor && !harness) return { ok: false, reason: `IA desconhecida: ${e.provedor}` }
  if (harness && papel === 'implement' && !harness.agentic) return { ok: false, reason: `${harness.name} nao edita arquivos; nao pode implementar` }
  if (ENTREGUES.includes(card.fm.status ?? '')) return { ok: false, reason: `#${id} ja foi entregue` }
  const espera = motivoParaEsperarHarness(id)
  if (espera) return { ok: false, reason: espera }
  const modelo: Fields = papel === 'implement' ? { orq_modelo: e.modelo ?? '' } : {}
  updateCardPorAcaoHumana(id, {
    fields: { [campoDeOverrideDoPapel(papel)]: e.provedor, [campoDaEscolhaHumana(papel)]: e.provedor, ...modelo },
    log: `${isoNow()} IA do papel ${papel} definida pelo humano: ${e.provedor || 'padrao do motor'}${e.modelo ? ` (${e.modelo})` : ''}`,
  })
  const depois = readCard(id)
  if (depois) prepararProjetoDaIa(depois)
  if (depois && depois.fm.status === 'CLARIFY' && depois.fm.pacote_status === 'aguardando') {
    const pacote = montarPacote(depois)
    gravarPacote(pacote)
    patchCard(id, { pacote_hash: pacote.hash, pacote_aprovado_hash: '', pacote_resumo: resumoDoPacote(pacote) })
  }
  return { ok: true, reason: '' }
}
