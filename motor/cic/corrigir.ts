import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { isoNow } from '../cdl'
import type { FailureClass, Usage, VerifyResult } from '../cdl'
import { CARD_BUDGET_USD } from '../cdl/ali/config'
import { readCard, patchCard, repoPath } from '../cdl/store'
import { warnBudgetWithoutGuarantee } from '../euc/tsr/confianca'
import { runGit, stageAll } from '../qlb/git'
import { ensureUrl, hasDevServer, urlPort, httpOk, inspectUrl, waitHttp } from './crv/url-viva'
import { implement, runStep } from './agente'
import { appendAttempt, readAttempts } from './rpr/tentativas'
import { applyFailurePolicy } from './rpr/politica'

export interface CorrectDeps {
  implement: typeof implement
  runStep: typeof runStep
}

interface StepOutcome {
  ok: boolean
  text: string
  fullText: string
  cost: number
  tokens: number
  failureClass?: FailureClass
  failureReason?: string
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

function attemptHistory(id: string): string {
  const prior = readAttempts(id)
  if (!prior.length) return ''
  const lines = prior.map(a => `- [${a.kind}] pedido: ${a.reason} | resultado: ${a.response.replace(/\s+/g, ' ').slice(0, 200)}`).join('\n')
  return `Historico de tentativas anteriores neste card (NAO repita os mesmos erros; leve o feedback em conta):\n${lines}\n\n`
}

async function redoUrl(card: NonNullable<ReturnType<typeof readCard>>, wt: string, instruction: string, implementar: typeof implement): Promise<StepOutcome> {
  const r = await implementar(card, wt, `${attemptHistory(card.fm.id ?? '')}O url anterior foi REJEITADO pelo revisor. Refaça a tarefa atendendo exatamente: "${instruction}".`, card.fm.surface === 'visual')
  return { ok: r.ok, text: r.resultText ?? r.reason ?? '', fullText: r.fullText ?? r.resultText ?? r.reason ?? '', cost: parseFloat(r.cost) || 0, tokens: tokensOf(r.usage), failureClass: r.failureClass, failureReason: r.failureReason, provider: r.provider }
}

async function scopedFix(wt: string, instruction: string, file: string, line: string, lineText: string, id: string, executar: typeof runStep): Promise<StepOutcome> {
  const r = await executar(wt, 'limpio', scopedInstruction(instruction, file, line, lineText), id)
  return { ok: r.ok, text: r.text, fullText: r.text, cost: r.cost, tokens: r.tokens, failureClass: r.failureClass, failureReason: r.failureReason, provider: r.provider }
}

export async function handleCorrect(id: string, deps: CorrectDeps = { implement, runStep }): Promise<void> {
  const card = readCard(id)
  if (!card) return
  if (CARD_BUDGET_USD > 0 && (parseFloat(card.fm.cost_usd || '0') || 0) > CARD_BUDGET_USD) {
    patchCard(id, { status: 'HALTED', correction: '', correction_file: '', correction_line: '', correction_line_text: '' }, `${isoNow()} CORRECTING->HALTED orcamento excedido (US$${card.fm.cost_usd} > US$${CARD_BUDGET_USD}) antes de refazer — decida se continua`)
    return
  }
  warnBudgetWithoutGuarantee(id, card.fm, CARD_BUDGET_USD)
  const instruction = card.fm.correction ?? ''
  const file = card.fm.correction_file ?? ''
  const line = card.fm.correction_line ?? ''
  const lineText = card.fm.correction_line_text ?? ''
  const wt = card.fm.worktree ?? ''
  if (!wt || !existsSync(join(wt, '.git'))) {
    patchCard(id, { status: 'HALTED', correction: '', correction_file: '', correction_line: '', correction_line_text: '' }, `${isoNow()} CORRECTING->HALTED correção sem worktree valido`)
    return
  }
  const target = repoPath(card.fm.repo ?? '')
  const redo = !file
  process.stdout.write(`[runner] #${id}: ${redo ? 'refazendo url (rejeitado)' : 'aplicando correção'} em ${wt}\n`)
  const r = redo ? await redoUrl(card, wt, instruction, deps.implement) : await scopedFix(wt, instruction, file, line, lineText, id, deps.runStep)
  appendAttempt(id, redo ? 'reprovacao' : 'correcao', instruction, r.fullText)
  if (!r.ok) {
    const outcome = applyFailurePolicy({
      id,
      fromStatus: 'CORRECTING',
      resumeStatus: 'CORRECTING',
      provider: r.provider ?? '',
      failureClass: r.failureClass ?? 'terminal',
      failureReason: r.failureReason ?? 'falha nao classificada',
      technicalDetail: r.text,
    })
    if (outcome === 'halt') patchCard(id, { correction: '', correction_file: '', correction_line: '', correction_line_text: '' })
    return
  }
  await commit(wt, redo ? `feat: refaz url apos rejeicao (#${id})` : `fix: correção humana (#${id})`)
  patchCard(id, {
    status: 'URL',
    correction: '',
    correction_file: '',
    correction_line: '',
    correction_line_text: '',
    verify: 'inconclusivo',
    wait_attempts: '',
  }, `${isoNow()} CORRECTING->URL ${redo ? 'url refeito' : 'correção aplicada'}: ${r.text || 'ok'} (verificando…) (custo $${r.cost.toFixed(4)} · ${r.tokens} tokens)`)
  process.stdout.write(`[runner] #${id}: URL apos ${redo ? 'refação' : 'correção'} (verificando)\n`)
  const reval = await revalidate(id, wt, target)
  const estado = reval.conclusive === false ? 'inconclusivo' : (reval.ok ? 'ok' : 'falhou')
  patchCard(id, { verify: estado }, `${isoNow()} inspecao pos-${redo ? 'refação' : 'correção'}: ${estado} — ${reval.reason}`)
}
