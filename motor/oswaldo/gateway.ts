import { encerrando } from './mutirao/encerramento.ts'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readCard, repoPath, patchCard } from '../cordel/store.ts'
import { isoNow } from '../cordel/util.ts'
import type { Card, ImplementResult } from '../cordel/tipos.ts'
import { cardsDir, quotaFallbackLigado, RUN_TIMEOUT_MS } from '../cordel/alicerce/config.ts'
import { objetivoComInstrucoes } from '../mirante/instruir.ts'
import { providerFor, modelFor, effortFor, modoFor } from '../tomada/registro.ts'
import { runProvider, warnBudgetWithoutGuarantee } from '../euclides/tesouro/confianca.ts'
import { gastoDoCard, tetoDoCard } from '../euclides/tesouro/orcamento.ts'
import { classifyFailure } from '../ciclo/reprise/classe-de-falha.ts'
import { applyFailurePolicy } from '../ciclo/reprise/politica.ts'
import { writeRun, resolvedFailure } from '../euclides/registros.ts'
import { decidirRota, rotaTentadas, comTentativaDeRota } from '../tomada/rota.ts'
import { gravarDiagnostico, redigirDiagnostico, resumoDoDiagnostico } from '../tomada/diagnostico.ts'
import { gravarChamadaNoLiveLog } from '../tomada/harness/live-log.ts'
import { contextoDaTrocaDeIa, registrarTrocaDeIaNoLiveLog } from '../tomada/rota-log.ts'

export async function chamarGateway(card: Card, cwd: string): Promise<ImplementResult> {
  const override = card.fm.provider_override_implement || undefined
  const provider = providerFor('implement', override)
  const model = modelFor('implement', override)
  const res = await runProvider(card.fm.id ?? '', provider, {
    prompt: [card.fm.rota_contexto || '', objetivoComInstrucoes(card.body, card.fm.title ?? '')].filter(Boolean).join('\n\n'),
    cwd, dirs: [cwd], mode: 'edit', useAgents: false, model,
    effort: effortFor('implement', card.fm.effort), modo: modoFor('implement', override),
    timeoutMs: RUN_TIMEOUT_MS, liveLog: join(cardsDir(), 'runs', `${card.fm.id}.live.log`), rotulo: 'gateway',
  }, 'implement')
  const comum = { cost: String(res.cost), costMeasured: res.costMeasured, usage: res.usage, provider: provider.name, model }
  if (res.ok) return { ...comum, ok: true, resultText: res.text.slice(0, 140), fullText: res.text }
  const falha = classifyFailure(provider, res)
  return { ...comum, ok: false, reason: [res.detail, res.text].filter(Boolean).join('\n'), timedOut: res.timedOut, failureClass: falha.failureClass, failureReason: falha.reason, waitClass: falha.classeDeEspera }
}

export async function executarGateway(id: string, deps = { chamar: chamarGateway, rota: decidirRota }): Promise<void> {
  // Uma tentativa por provedor. Nao reinicia o pedido nem troca o diretorio.
  for (let tentativa = 0; tentativa < 16; tentativa++) {
    const card = readCard(id)
    if (!card || card.fm.status !== 'EXECUTING') return
    const cwd = repoPath(card.fm.repo ?? '')
    const gasto = gastoDoCard(card.fm.cost_usd)
    const teto = tetoDoCard()
    if (!existsSync(cwd) || gasto === null || gasto >= teto) {
      patchCard(id, { status: 'HALTED', halt_class: gasto === null || (gasto ?? 0) >= teto ? 'orcamento' : 'terminal', halt_reason: 'gateway: verifique projeto e orcamento' }, `${isoNow()} EXECUTING->HALTED gateway sem precondicoes`)
      return
    }
    warnBudgetWithoutGuarantee(id, card.fm, teto)
    const inicio = Date.now()
    let bruto: ImplementResult
    try {
      bruto = await deps.chamar(card, cwd)
    } catch (e) {
      const provider = providerFor('implement', card.fm.provider_override_implement || undefined)
      const detalhe = redigirDiagnostico(e instanceof Error ? e.message : String(e))
      const falha = classifyFailure(provider, { timedOut: false, detail: detalhe, text: '' })
      bruto = { ok: false, cost: '0', provider: provider.name, reason: detalhe, failureClass: falha.failureClass, failureReason: falha.reason, waitClass: falha.classeDeEspera }
    }
    const res = bruto.ok ? bruto : { ...bruto, reason: redigirDiagnostico(bruto.reason ?? ''), failureReason: redigirDiagnostico(bruto.failureReason ?? '') || undefined }
    const duracao = (Date.now() - inicio) / 1000
    const run = writeRun(id, res, duracao)
    const totais = { cost_usd: (gasto + (Number(res.cost) || 0)).toFixed(4), tokens_total: String(Number(card.fm.tokens_total || 0) + run.tokens_total), tempo_s: String(Number(card.fm.tempo_s || 0) + duracao) }
    if (readCard(id)?.fm.status !== 'EXECUTING') { patchCard(id, totais); return }
    if (res.ok) {
      patchCard(id, { ...totais, status: 'COMPLETED', rota_tentados: '' }, `${isoNow()} EXECUTING->COMPLETED gateway concluido; session #${card.fm.sessao_id || id} continua aberta`)
      return
    }
    // SIGTERM encerra o harness para drenar o daemon. A reconciliacao retoma
    // esta execucao no proximo arranque; nao transforme a parada em HALTED.
    if (encerrando()) {
      patchCard(id, totais)
      const diagnostico = gravarDiagnostico(id, { provedor: res.provider ?? '', falha: 'chamada interrompida pelo encerramento do motor', detalhe: res.reason ?? '' })
      gravarChamadaNoLiveLog({ caminho: join(cardsDir(), 'runs', `${id}.live.log`), rotulo: 'retomada', linhas: [
        'motor encerrando; a mesma tarefa sera retomada no proximo inicio',
        diagnostico ? `diagnostico: ${diagnostico}` : 'diagnostico indisponivel — verifique permissoes e espaco em disco',
      ] })
      return
    }
    const { failureClass, failureReason } = resolvedFailure(res)
    const rota = failureClass === 'quota' && quotaFallbackLigado()
      ? deps.rota({ papel: 'implement', classeDeFalha: failureClass, provedorAtual: res.provider ?? '', tentadosNestaRodada: rotaTentadas(card.fm.rota_tentados) })
      : { acao: 'manter_politica_atual' as const, motivo: '' }
    if (rota.acao === 'trocar' && rota.para !== res.provider && !rotaTentadas(card.fm.rota_tentados).includes(rota.para)) {
      const troca = { id, papel: 'implement' as const, de: res.provider, para: rota.para, falha: failureReason, detalhe: res.reason, motivo: rota.motivo }
      registrarTrocaDeIaNoLiveLog(troca)
      patchCard(id, { ...totais, provider_override_implement: rota.para, rota_tentados: comTentativaDeRota(card.fm.rota_tentados, res.provider), rota_contexto: contextoDaTrocaDeIa(troca) }, `${isoNow()} gateway: mudando automaticamente para ${rota.para}; falha: ${failureReason}`)
      continue
    }
    const diagnostico = gravarDiagnostico(id, { provedor: res.provider ?? '', falha: failureReason, detalhe: res.reason ?? '', motivo: rota.motivo })
    const outcome = applyFailurePolicy({ id, fromStatus: 'EXECUTING', resumeStatus: 'EXECUTING', provider: res.provider ?? '', failureClass, failureReason, waitClass: res.waitClass, technicalDetail: res.reason ?? '', extraFields: totais })
    const acao = outcome === 'waiting'
      ? `retomada automatica em ${readCard(id)?.fm.wait_until ?? 'breve'}; /stop ${id} para interromper`
      : failureClass === 'quota' ? 'sem destino apto; escolha outra IA com /ia ou aguarde a renovacao da cota'
      : /credencial|autentic/i.test(failureReason) ? 'refaca a autenticacao com /login e retome a tarefa'
      : /instalado|binario/i.test(failureReason) ? 'instale o CLI do provedor ou escolha outra IA com /ia e retome a tarefa'
      : 'corrija a causa indicada e retome a tarefa'
    gravarChamadaNoLiveLog({ caminho: join(cardsDir(), 'runs', `${id}.live.log`), rotulo: 'falha gateway', linhas: [
      `IA ${res.provider || 'desconhecida'} falhou: ${resumoDoDiagnostico(failureReason)}`,
      `proxima acao: ${acao}`,
      diagnostico ? `diagnostico: ${diagnostico}` : 'diagnostico indisponivel — verifique permissoes e espaco em disco',
    ] })
    return
  }
  patchCard(id, { status: 'HALTED', halt_class: 'quota', halt_reason: 'limite de trocas atingido' }, `${isoNow()} EXECUTING->HALTED limite de trocas atingido`)
}
