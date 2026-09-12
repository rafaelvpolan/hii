import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { isoNow } from '../cordel/index.ts'
import type { ClasseDeEspera, FailureClass, Usage, VerifyResult } from '../cordel/index.ts'
import { gastoDoCard, tetoDoCard } from '../euclides/tesouro/orcamento.ts'
import { readCard, patchCard, repoBase, repoPath } from '../cordel/store.ts'
import type { Card } from '../cordel/index.ts'
import { warnBudgetWithoutGuarantee } from '../euclides/tesouro/confianca.ts'
import { runGit, stageAll } from '../quilombo/git.ts'
import { ensureUrl, hasDevServer, urlPort, httpOk, inspectUrl, waitHttp } from './crivo/url-viva.ts'
import { aprovarUrlPeloMotor, decisaoDeAprovacaoDeUrl } from './crivo/aprovacao-automatica.ts'
import { implement, runStep } from './agente.ts'
import { appendAttempt, readAttempts } from './reprise/tentativas.ts'
import { applyFailurePolicy } from './reprise/politica.ts'
import { conferirInstrucoes, listaNumerada, pendentesDoCard, registrarConferencia } from './crivo/conferencia-de-instrucoes.ts'
import type { InstrucaoNumerada, ItemConferido } from './crivo/conferencia-de-instrucoes.ts'

export interface CorrectDeps {
  implement: typeof implement
  runStep: typeof runStep
  conferir?: typeof conferirInstrucoes
}

export const MAX_VOLTAS_DE_INSTRUCAO = 3

interface StepOutcome {
  ok: boolean
  text: string
  fullText: string
  cost: number
  tokens: number
  failureClass?: FailureClass
  failureReason?: string
  waitClass?: ClasseDeEspera
  provider?: string
}

function tokensOf(u: Usage | undefined): number {
  return u ? (u.tokens_in || 0) + (u.tokens_out || 0) + (u.tokens_cache_create || 0) : 0
}

function scopedInstruction(instruction: string, file: string, line: string, lineText: string): string {
  if (file && line) {
    const cur = lineText ? ` A linha atual é: \`${lineText}\`.` : ''
    return `Correção pedida pelo revisor humano no arquivo ${file}, linha ${line}.${cur} Aplique exatamente: "${instruction}". Faça a MENOR mudança possível, mexendo só no necessário ao redor dessa linha. Não rode git, não inicie servidores.`
  }
  const target = file ? ` Arquivo alvo: ${file}.` : ''
  return `Correção pedida pelo revisor humano.${target} Faça a MENOR mudança que atenda: "${instruction}". Não mude nada fora do necessário. Não rode git, não inicie servidores.`
}

async function revalidate(id: string, wt: string, target: string): Promise<VerifyResult> {
  if (!hasDevServer(target)) return { ok: true, conclusive: false, reason: 'sem dev server — verificacao humana pelo link', cost: 0, tokens: 0 }
  const port = urlPort(id)
  const url = `http://localhost:${port}`
  let up = await httpOk(url)
  if (!up) {
    await ensureUrl(wt, port, target)
    up = await waitHttp(url, 25)
  }
  if (!up) return { ok: true, conclusive: false, reason: 'dev server nao respondeu — nao deu para verificar', cost: 0, tokens: 0 }
  const health = await inspectUrl(id, url, true)
  if (!health.conclusive) return { ok: true, conclusive: false, reason: `url no ar — confira pelo link (inspecao automatica indisponivel${health.detail ? ': ' + health.detail : ''})`, cost: 0, tokens: 0 }
  return health.ok
    ? { ok: true, conclusive: true, reason: 'url no ar — confira pelo link', cost: 0, tokens: 0 }
    : { ok: false, conclusive: true, reason: `url com erro: ${health.detail}`, cost: 0, tokens: 0 }
}

async function commit(wt: string, message: string): Promise<void> {
  await stageAll(wt)
  const staged = (await runGit(wt, ['diff', '--cached', '--name-only'])).stdout.trim()
  if (!staged) return
  await runGit(wt, ['-c', 'commit.gpgsign=false', 'commit', '-m', message])
}

export function attemptHistory(id: string): string {
  const prior = readAttempts(id)
  if (!prior.length) return ''
  const lines = prior.map(a => `- [${a.kind}${a.provedor ? ` por ${a.provedor}` : ''}] pedido: ${a.reason} | resultado: ${a.response.replace(/\s+/g, ' ').slice(0, 200)}`).join('\n')
  return `Historico de tentativas anteriores neste card (NAO repita os mesmos erros; leve o feedback em conta — cada tentativa diz qual IA a escreveu, e voce pode ser OUTRA):\n${lines}\n\n`
}

export function pedidoDeRefacao(instruction: string, pendentes: readonly InstrucaoNumerada[], faltaram: readonly ItemConferido[], novas: number): string {
  const cabeca = pendentes.length
    ? `O url anterior foi REJEITADO pelo revisor. Refaça atendendo TODAS as instruções abaixo, uma por uma, e no relato final diga o que fez para cada número:\n${listaNumerada(pendentes)}`
    : `O url anterior foi REJEITADO pelo revisor. Refaça a tarefa atendendo exatamente: "${instruction}".`
  const cobranca = faltaram.length
    ? `\n\nA CONFERÊNCIA da volta anterior constatou que estas instruções NÃO foram atendidas — atenda-as agora: ${faltaram.map(f => `#${f.numero} (${f.motivo})`).join('; ')}.`
    : ''
  const chegaram = novas > 0 ? `\n\n${novas} instrução(ões) nova(s) chegaram enquanto a volta anterior rodava; elas já estão na lista acima.` : ''
  return `${cabeca}${cobranca}${chegaram}`
}

async function redoUrl(card: Card, wt: string, pedido: string, implementar: typeof implement): Promise<StepOutcome> {
  const r = await implementar(card, wt, `${attemptHistory(card.fm.id ?? '')}${pedido}`, card.fm.surface === 'visual')
  return { ok: r.ok, text: r.resultText ?? r.reason ?? '', fullText: r.fullText ?? r.resultText ?? r.reason ?? '', cost: parseFloat(r.cost) || 0, tokens: tokensOf(r.usage), failureClass: r.failureClass, failureReason: r.failureReason, waitClass: r.waitClass, provider: r.provider }
}

interface Voltas {
  ultimo: StepOutcome
  cost: number
  tokens: number
  parou: boolean
}

async function refazerAtendendoInstrucoes(card: Card, wt: string, instruction: string, teto: number, gastoInicial: number, deps: CorrectDeps): Promise<Voltas> {
  const id = card.fm.id ?? ''
  const base = repoBase(card.fm.repo ?? '')
  const conferir = deps.conferir ?? conferirInstrucoes
  let cost = 0
  let tokens = 0
  let faltaram: ItemConferido[] = []
  let novas = 0
  let ultimo: StepOutcome = { ok: true, text: '', fullText: '', cost: 0, tokens: 0 }
  for (let volta = 1; volta <= MAX_VOLTAS_DE_INSTRUCAO; volta++) {
    const atual = readCard(id) ?? card
    const pendentes = pendentesDoCard(atual)
    if (!pendentes.length && volta > 1) break
    const pedido = pedidoDeRefacao(instruction, pendentes, faltaram, novas)
    if (volta > 1) patchCard(id, {}, `${isoNow()} refação — volta ${volta}/${MAX_VOLTAS_DE_INSTRUCAO}: instruções pendentes ${pendentes.map(p => `#${p.numero}`).join(', ')}`)
    ultimo = await redoUrl(atual, wt, pedido, deps.implement)
    appendAttempt(id, 'reprovacao', pendentes.length ? listaNumerada(pendentes) : instruction, ultimo.fullText, ultimo.provider ?? '')
    cost += ultimo.cost
    tokens += ultimo.tokens
    if (!ultimo.ok) return { ultimo, cost, tokens, parou: true }
    await commit(wt, `feat: refaz url apos rejeicao (#${id})`)
    if (!pendentes.length) break
    const conferencia = await conferir(id, wt, base, pendentes)
    cost += conferencia.cost
    tokens += conferencia.tokens
    const registro = registrarConferencia(id, conferencia)
    if (!registro.conclusiva) break
    faltaram = registro.faltam
    const depois = readCard(id)
    novas = depois ? pendentesDoCard(depois).filter(p => !pendentes.some(q => q.numero === p.numero)).length : 0
    if (!faltaram.length && !novas) break
    if (volta === MAX_VOLTAS_DE_INSTRUCAO) {
      patchCard(id, {}, `${isoNow()} refação: teto de ${MAX_VOLTAS_DE_INSTRUCAO} voltas — seguem sem atendimento ${faltaram.map(f => `#${f.numero}`).join(', ')}${novas ? ` e ${novas} instrução(ões) nova(s)` : ''}; a decisão fica com você`)
      break
    }
    if (teto > 0 && gastoInicial + cost > teto) {
      patchCard(id, {}, `${isoNow()} refação: orçamento (US$${(gastoInicial + cost).toFixed(4)} > US$${teto}) impede outra volta — seguem sem atendimento ${faltaram.map(f => `#${f.numero}`).join(', ')}`)
      break
    }
  }
  return { ultimo, cost, tokens, parou: false }
}

async function scopedFix(wt: string, instruction: string, file: string, line: string, lineText: string, id: string, alvo: string, executar: typeof runStep): Promise<StepOutcome> {
  const r = await executar(wt, 'limpio', scopedInstruction(instruction, file, line, lineText), id, alvo)
  return { ok: r.ok, text: r.text, fullText: r.text, cost: r.cost, tokens: r.tokens, failureClass: r.failureClass, failureReason: r.failureReason, waitClass: r.waitClass, provider: r.provider }
}

export async function handleCorrect(id: string, deps: CorrectDeps = { implement, runStep }): Promise<void> {
  const card = readCard(id)
  if (!card) return
  const teto = tetoDoCard()
  const gasto = gastoDoCard(card.fm.cost_usd)
  if (gasto === null) {
    const motivo = `cost_usd=${JSON.stringify(card.fm.cost_usd)} nao e numero — "gastou 0" liberaria a refacao paga sem saber o que o card ja custou`
    patchCard(id, { status: 'HALTED', halt_class: 'orcamento', halt_reason: motivo, correction: '' }, `${isoNow()} CORRECTING->HALTED ${motivo}`)
    return
  }
  if (teto > 0 && gasto > teto) {
    const motivo = `orcamento excedido (US$${card.fm.cost_usd} > US$${teto}) antes de refazer — decida se continua`
    patchCard(id, { status: 'HALTED', halt_class: 'orcamento', halt_reason: motivo, correction: '', correction_file: '', correction_line: '', correction_line_text: '' }, `${isoNow()} CORRECTING->HALTED ${motivo}`)
    return
  }
  warnBudgetWithoutGuarantee(id, card.fm, teto)
  const instruction = card.fm.correction ?? ''
  const file = card.fm.correction_file ?? ''
  const line = card.fm.correction_line ?? ''
  const lineText = card.fm.correction_line_text ?? ''
  const wt = card.fm.worktree ?? ''
  if (!wt || !existsSync(join(wt, '.git'))) {
    const motivo = 'correção sem worktree valido'
    patchCard(id, { status: 'HALTED', halt_class: 'terminal', halt_reason: motivo, correction: '', correction_file: '', correction_line: '', correction_line_text: '' }, `${isoNow()} CORRECTING->HALTED ${motivo}`)
    return
  }
  const target = repoPath(card.fm.repo ?? '')
  const redo = !file
  process.stdout.write(`[runner] #${id}: ${redo ? 'refazendo url (rejeitado)' : 'aplicando correção'} em ${wt}\n`)
  const voltas = redo
    ? await refazerAtendendoInstrucoes(card, wt, instruction, teto, gasto, deps)
    : null
  const r = voltas ? voltas.ultimo : await scopedFix(wt, instruction, file, line, lineText, id, repoPath(card.fm.repo ?? ''), deps.runStep)
  if (!voltas) appendAttempt(id, 'correcao', instruction, r.fullText, r.provider ?? '')
  const custoDaRodada = voltas ? voltas.cost : r.cost
  const tokensDaRodada = voltas ? voltas.tokens : r.tokens
  const tokensAntes = Number(card.fm.tokens_total || '0') || 0
  if (!r.ok) {
    if (custoDaRodada || tokensDaRodada) {
      patchCard(id, { cost_usd: (gasto + custoDaRodada).toFixed(4), tokens_total: String(tokensAntes + tokensDaRodada) }, `${isoNow()} ${redo ? 'refação' : 'correção'} falhou depois de gastar $${custoDaRodada.toFixed(4)} · ${tokensDaRodada} tokens — custo contabilizado`)
    }
    const outcome = applyFailurePolicy({
      id,
      fromStatus: 'CORRECTING',
      resumeStatus: 'CORRECTING',
      provider: r.provider ?? '',
      failureClass: r.failureClass ?? 'terminal',
      failureReason: r.failureReason ?? 'falha nao classificada',
      waitClass: r.waitClass,
      papel: 'implement',
      technicalDetail: r.text,
    })
    if (outcome === 'halt') patchCard(id, { correction: '', correction_file: '', correction_line: '', correction_line_text: '' })
    return
  }
  if (!voltas) await commit(wt, `fix: correção humana (#${id})`)
  // O custo da correcao entrava SO no texto da mensagem abaixo e nunca no
  // frontmatter — o card 001 prova: cost_usd ficou em 2.2684 enquanto o diario
  // registrava "custo $1.5380 · 92122 tokens" de uma correcao que ja tinha rodado.
  // Como cinco portoes de orcamento leem `cost_usd`, todos decidiam sobre um numero
  // 41% menor que o real. `gasto` e o valor conferido na entrada deste handler
  // (linha 88), ja garantido numerico; somar sobre ele e o mesmo que o fecho faz.
  patchCard(id, {
    status: 'URL',
    correction: '',
    correction_file: '',
    correction_line: '',
    correction_line_text: '',
    verify: 'inconclusivo',
    wait_attempts: '',
    cost_usd: (gasto + custoDaRodada).toFixed(4),
    tokens_total: String(tokensAntes + tokensDaRodada),
  }, `${isoNow()} CORRECTING->URL ${redo ? 'url refeito' : 'correção aplicada'}: ${r.text || 'ok'} (verificando…) (custo $${custoDaRodada.toFixed(4)} · ${tokensDaRodada} tokens)`)
  process.stdout.write(`[runner] #${id}: URL apos ${redo ? 'refação' : 'correção'} (verificando)\n`)
  const reval = await revalidate(id, wt, target)
  const estado = reval.conclusive === false ? 'inconclusivo' : (reval.ok ? 'ok' : 'falhou')
  patchCard(id, { verify: estado }, `${isoNow()} inspecao pos-${redo ? 'refação' : 'correção'}: ${estado} — ${reval.reason}`)
  if (readCard(id)?.fm.status !== 'URL') return
  const temUrl = hasDevServer(target)
  const respondeu = temUrl ? await httpOk(`http://localhost:${urlPort(id)}`) : false
  const decisao = decisaoDeAprovacaoDeUrl({ temUrl, respondeu, verify: estado })
  if (decisao.aprova) {
    aprovarUrlPeloMotor(id, decisao.motivo)
    process.stdout.write(`[runner] #${id}: URL_OK sem pergunta — ${decisao.motivo}\n`)
  } else {
    patchCard(id, {}, `${isoNow()} url fica com voce: ${decisao.motivo}`)
  }
}
