import { redigirDiagnostico } from '../../tomada/diagnostico.ts'
import { isoNow } from '../../cordel/index.ts'
import type { Fields } from '../../cordel/index.ts'
import { classifyFailure } from '../../ciclo/reprise/classe-de-falha.ts'
import type { AgentRequest, AgentResult, Harness } from '../../tomada/tipos.ts'
import { COST_UNKNOWN } from './custo.ts'
import { emptyUsage } from '../../tomada/uso.ts'
import { patchCard, patchCardWith, readCard } from '../../cordel/store.ts'
import { addProvider, classifyCostGap, floorProviders, formatProviders, parseProviders, removeProvider } from './lacuna.ts'
import { registrarChamada, sessaoDoCard } from '../ias-da-sessao.ts'
import type { PapelDeChamada } from '../ias-da-sessao.ts'
import { sessaoAtual } from '../sessao.ts'
import { sumTokens } from '../../tomada/uso.ts'
import { atualizarRegistroDeConversa } from '../registros.ts'
import { esquecerHarness, registrarHarness } from '../../tomada/harness-em-voo.ts'
import { contextoDaSessao, iniciarSubsessao, finalizarChamada, lerSessaoHii } from '../sessoes.ts'
import { iniciar, atualizar, terminar, saida, recurso, escopoAtual, heartbeat } from '../../observabilidade/registro.ts'

function semReporte(fm: Fields, provider: string): boolean {
  return parseProviders(fm.cost_unverified).includes(provider)
}

function noPiso(fm: Fields, provider: string): boolean {
  return parseProviders(fm.cost_floor).includes(provider)
}

function linhaDeLimpeza(fm: Fields, provider: string): string {
  const resto = formatProviders(removeProvider(fm.cost_unverified, provider))
  const cauda = resto ? `; segue sem reporte: ${resto}` : ''
  return `${isoNow()} custo medido: ${provider} informou o gasto desta chamada — marca de custo nao reportado retirada (o cost_usd deste card segue sendo piso)${cauda}`
}

export function markCostUnverified(id: string, provider: string): void {
  if (!id || !provider) return
  patchCardWith(
    id,
    (fm): Fields => (semReporte(fm, provider)
      ? {}
      : {
        cost_unverified: formatProviders(addProvider(fm.cost_unverified, provider)),
        cost_floor: formatProviders(addProvider(fm.cost_floor, provider)),
      }),
    fm => (semReporte(fm, provider)
      ? ''
      : `${isoNow()} custo NAO reportado: a chamada a ${provider} terminou sem informar gasto — o cost_usd deste card e piso medido, nao o total`),
  )
}

export function markCostFloor(id: string, provider: string): void {
  if (!id || !provider) return
  if (noPiso(readCard(id)?.fm ?? {}, provider)) return
  patchCardWith(
    id,
    (fm): Fields => (noPiso(fm, provider) ? {} : { cost_floor: formatProviders(addProvider(fm.cost_floor, provider)) }),
    fm => (noPiso(fm, provider)
      ? ''
      : `${isoNow()} chamada a ${provider} terminou sem concluir — o gasto ate a interrupcao nao foi reportado e nao entra no cost_usd, que segue sendo piso`),
  )
}

export function clearCostUnverified(id: string, provider: string): void {
  if (!id || !provider) return
  if (!semReporte(readCard(id)?.fm ?? {}, provider)) return
  patchCardWith(
    id,
    (fm): Fields => (semReporte(fm, provider) ? { cost_unverified: formatProviders(removeProvider(fm.cost_unverified, provider)) } : {}),
    fm => (semReporte(fm, provider) ? linhaDeLimpeza(fm, provider) : ''),
  )
}

export function recordCostTrust(id: string, provider: string, res: AgentResult): void {
  const gap = classifyCostGap(res)
  if (gap === 'measured') clearCostUnverified(id, provider)
  else if (gap === 'unreported') markCostUnverified(id, provider)
  else if (gap === 'call_failed') markCostFloor(id, provider)
}

export function recusaPorLimite(provider: Harness, req: AgentRequest): string {
  // capabilities() e obrigatoria: nao existe mais o caso "nao declarou, entao
  // pode tudo", que era permissividade silenciosa.
  const capacidades = provider.capabilities()
  if (req.mode === 'edit' && !provider.agentic) return `${provider.name} nao executa tarefas com edicao de arquivos`
  if (req.mode === 'readonly' && !capacidades.isolatesReadonly) {
    return `${provider.name} nao sabe rodar em modo somente-leitura (nao restringe ferramenta) — um papel de verificacao nele poderia editar arquivo`
  }
  if (req.expectsJson === true && !capacidades.emitsStructuredJson) {
    return `${provider.name} nao declara saida JSON estruturada — o veredito deste papel sairia inparseavel e o card iria de HALT em vez de recusa clara; escolha outra ia para o papel (ex.: /ia gate claude)`
  }
  return ''
}

export function sessaoParaChamada(id: string): string {
  return id ? sessaoDoCard(id) : `conversa-${sessaoAtual()}`
}

// O registro NAO pode derrubar a chamada de agente que ele descreve: o token ja
// foi gasto, e perder o resultado por causa do ledger seria trocar um problema
// por um pior. Mas engolir calado fazia o unico escritor do ledger falhar em
// silencio — o gasto desaparecia da conta e do teto, e nada no diario dizia que
// desapareceu. Grita, uma vez por motivo, para o gasto perdido ser um fato
// observavel em vez de uma lacuna.
const falhasDeRegistroAvisadas = new Set<string>()

function semPropagarFalhaDeRegistro(registro: () => void): void {
  try {
    registro()
  } catch (e) {
    const motivo = String((e as Error).message ?? e).slice(0, 160)
    if (falhasDeRegistroAvisadas.has(motivo)) return
    falhasDeRegistroAvisadas.add(motivo)
    // A causa anunciada apontava para o lugar errado: o teto por card le
    // `card.fm.cost_usd`, escrito pelo executar/fechar independentemente do ledger.
    // O que se perde aqui e o ledger por SESSAO e por PAPEL (o /config e o
    // historico), nao o portao de orcamento.
    process.stderr.write(`[hicode] NAO consegui registrar uma chamada de agente no ledger da sessao (${motivo}) — esta chamada nao vai aparecer no /config nem no historico por papel. O teto por card nao e afetado (ele le cost_usd do card). O trabalho continua; a conta por sessao fica incompleta.\n`)
  }
}

// Chamado pelo teste (e disponivel para quem precise reabrir o aviso num daemon
// longo): o Set e por processo, entao sem reset a segunda falha do MESMO motivo
// volta a ser silenciosa.
export function esquecerAvisosDeLedger(): void {
  falhasDeRegistroAvisadas.clear()
}

function anotarChamada(id: string, provider: Harness, req: AgentRequest, papel: PapelDeChamada, res: AgentResult, t0: number): void {
  semPropagarFalhaDeRegistro(() => {
    registrarChamada(sessaoParaChamada(id), {
      ts: isoNow(),
      papel,
      rotulo: req.rotulo ?? papel,
      provedor: provider.name,
      modelo: req.model ?? '',
      custoUsd: Number(res.cost) || 0,
      custoMedido: classifyCostGap(res) === 'measured',
      tokens: sumTokens(res.usage),
      tokensEntrada: res.usage.tokens_in || 0,
      tokensSaida: res.usage.tokens_out || 0,
      tokensCache: res.usage.tokens_cache_create || 0,
      duracaoS: Math.round((Date.now() - t0) / 1000),
      ok: res.ok === true,
      classeDeFalha: res.ok === true
        ? ''
        : classifyFailure(provider, { timedOut: res.timedOut, detail: res.detail, text: res.text }).failureClass,
    })
    if (!id) atualizarRegistroDeConversa(sessaoParaChamada(id))
  })
}

export async function runProvider(id: string, provider: Harness, req: AgentRequest, papel: PapelDeChamada = 'desconhecido'): Promise<AgentResult> {
  const recusa = recusaPorLimite(provider, req)
  if (recusa) {
    return {
      ok: false,
      failed: true,
      timedOut: false,
      isError: false,
      detail: recusa,
      text: '',
      ...COST_UNKNOWN,
      usage: emptyUsage(),
    }
  }
  const t0 = Date.now()
  let pidRegistrado = 0
  const fm = id ? readCard(id)?.fm : undefined
  const sessao = fm?.sessao_id || (fm?.tipo === 'session' ? id : '')
  const contexto = sessao && lerSessaoHii(sessao) ? contextoDaSessao(sessao) : ''
  const sub = contexto ? iniciarSubsessao(sessao, req.consultaId || id, provider.name, req.model ?? '', papel) : ''
  const atividade = iniciar({ repo: fm?.repo ?? escopoAtual()?.repo ?? '', sessao, execucao: fm?.tipo === 'session' ? '' : id },
    { ...recurso(provider.name, 'harness'), observabilidade: 'partial', capacidades: Object.entries(provider.capabilities()).filter(([, v]) => v).map(([k]) => k) },
    { provedorEfetivo: provider.name, modeloConfigurado: req.model ?? null, modeloEfetivo: req.model ?? null,
      papel, modo: req.mode, permissao: req.modo ?? null, esforco: req.effort ?? null,
      agentesSolicitados: req.useAgents, ferramentasInternas: 'nao observaveis por este contrato',
      saidaIncremental: provider.saidaIncremental?.(req) ?? false })
  atualizar(atividade, a => { a.subsessao = sub || null; a.microtask = req.microtask || fm?.microtask_atual || null; a.planoRevisao = fm?.plano_revisao ? Number(fm.plano_revisao) : null })
  let terminou = false
  const pulso = setInterval(() => heartbeat(atividade), 15000)
  pulso.unref()
  let emitiuResposta = false
  const pendente = new Map<'stdout' | 'stderr' | 'assistant' | 'error', string>()
  let envio: ReturnType<typeof setTimeout> | undefined
  const descarregar = (): void => {
    if (envio) clearTimeout(envio)
    envio = undefined
    for (const [canal, texto] of pendente) saida(atividade, canal, texto)
    pendente.clear()
  }
  let concluida = false
  try {
    const bruto = await provider.run({
      ...req,
      prompt: contexto ? `${contexto}\n\nPEDIDO ATUAL:\n${req.prompt}` : req.prompt,
      rotulo: req.rotulo ?? papel,
      aoEmitir: (canal, texto) => {
        if (canal === 'assistant') emitiuResposta = true
        pendente.set(canal, (pendente.get(canal) ?? '') + texto)
        if ((pendente.get(canal)?.length ?? 0) >= 8192) descarregar()
        else envio ??= setTimeout(descarregar, 100)
        // Telemetria de consumidores externos nao interfere no resultado pago.
        try { req.aoEmitir?.(canal, texto) } catch { /* observador isolado */ }
      },
      aoEvento: evento => {
        atualizar(atividade, a => {
          a.etapa = evento.tipo
          a.detalhes.progresso = 'evento confirmado pelo harness'
          a.detalhes.ultimoEvento = evento.tipo
          a.detalhes.ferramenta = 'ferramenta' in evento ? evento.ferramenta : null
          a.recurso.observabilidade = 'instrumented'
        })
        try { req.aoEvento?.(evento) } catch { /* observador isolado */ }
      },
      aoIniciar: (pid) => {
        pidRegistrado = pid
        registrarHarness(id, pid, papel)
        req.aoIniciar?.(pid)
      },
    })
    const res = bruto.ok ? bruto : { ...bruto, text: redigirDiagnostico(bruto.text), detail: redigirDiagnostico(bruto.detail) }
    descarregar()
    if (!emitiuResposta) saida(atividade, 'assistant', res.text)
    if (res.detail) saida(atividade, 'error', res.detail)
    atualizar(atividade, a => {
      const instante = new Date().toISOString()
      a.metricas.custoUsd = { valor: res.costMeasured ? res.cost : null, qualidade: res.costMeasured ? 'measured' : 'unknown', fonte: provider.name, instante }
      const tokensReportados = provider.capabilities().reportsTokens && sumTokens(res.usage) > 0
      a.metricas.tokens = { valor: tokensReportados ? sumTokens(res.usage) : null, qualidade: tokensReportados ? 'measured' : 'unknown', fonte: provider.name, instante }
      a.detalhes.timeout = res.timedOut
    })
    const paradaHumana = id && readCard(id)?.fm.halt_class === 'humano'
    terminar(atividade, paradaHumana ? 'cancelled' : res.ok ? 'succeeded' : 'failed', res.detail)
    terminou = true
    semPropagarFalhaDeRegistro(() => recordCostTrust(id, provider.name, res))
    anotarChamada(id, provider, req, papel, res, t0)
    if (sub) semPropagarFalhaDeRegistro(() => {
      finalizarChamada(sessao, sub, { ok: res.ok, texto: res.text || res.detail, interrompida: !!paradaHumana })
      concluida = true
    })
    return res
  } finally {
    descarregar()
    clearInterval(pulso)
    if (!terminou) terminar(atividade, 'failed', 'chamada interrompida por excecao; consulte a tarefa')
    if (pidRegistrado) esquecerHarness(id, pidRegistrado)
    if (sub && !concluida) semPropagarFalhaDeRegistro(() => finalizarChamada(sessao, sub, { ok: false, texto: 'chamada interrompida por excecao; resultado nao confirmado' }))
  }
}

export function warnBudgetWithoutGuarantee(id: string, fm: Fields, budgetUsd: number): void {
  const provedores = formatProviders(floorProviders(fm))
  if (!provedores || budgetUsd <= 0) return
  patchCard(id, {}, `${isoNow()} teto de US$${budgetUsd} SEM GARANTIA: ao menos uma chamada a ${provedores} terminou sem reportar gasto — US$${fm.cost_usd || '0'} e piso medido; o total real deste card nao e verificavel`)
}
