import { existsSync } from 'node:fs'
import { objetivoComInstrucoes } from '../../mir/instruir'
import { isoNow } from '../../cdl'
import type { StepMap, StepMetric } from '../../cdl'
import { CARD_BUDGET_USD, MAX_CONFLICT, maxReajuste, PROJECT_MEMORY } from '../../cdl/ali/config'
import { appendProjectMemory } from '../../csd/memoria'
import { readCard, patchCard, repoPath, repoBase } from '../../cdl/store'
import { warnBudgetWithoutGuarantee } from '../../euc/tsr/confianca'
import { pushOwnedBranch, removeWorktree, run, runGit, stageAll, worktreePath } from '../git'
import { pularCriacaoDePr } from './pr'
import type { PushResult } from '../git'
import { stopUrl } from '../../cic/crv/url-viva'
import { activeSteps } from '../../nmy/config'
import { aplicarLei, planSteps } from '../../osw/rta/perfil'
import { SUFIXO_DO_GATE, runGatedStep } from '../../cic/passo-com-gate'
import { updateRunSteps } from '../../euc/registros'
import { runCodefoxGate, runGatedReview, persistGate, buildPrBody, gateOutcome, gateHaltReason, withGateRetry } from '../../cic/crv/gate'
import { ensureContract } from '../../cdl/bss/armazenar'
import { podeAbrirPr } from '../../euc/rdr/doctor'
import { affectedPackage } from '../../mir/comandos'
import { addMetric, accumulatedTotals, haltForInspection, applyStepFailurePolicy } from '../../euc/metricas-de-fecho'
import { buildWithReajuste, testGate } from '../../cic/crv/portoes-de-fecho'
import type { RunCtx } from '../../cic/crv/portoes-de-fecho'
import { syncWithBase, revalidate } from './sync'
import { resumeStart, RESUME_POST_STEPS } from './retomar'
import { runStep } from '../../cic/agente'
import { executarComIdempotencia } from '../slv/idempotencia'
import { avaliarDiff } from '../../csd/lei/guarda'
import { rigorEstrito } from '../../cdl/ali/config'
import { conferirSetup, relatoDoSetup } from '../../cdl/bss/setup-ferramental'
import { exigirRedAntesDoGreen } from '../../agentes/chg/red-primeiro'

export interface FinishDeps {
  runStep: typeof runStep
  runCodefoxGate: typeof runCodefoxGate
}

async function commitAll(wt: string, message: string): Promise<void> {
  await stageAll(wt)
  await runGit(wt, ['-c', 'commit.gpgsign=false', 'commit', '-m', message])
}

function pushFailureDiagnostico(push: PushResult): string {
  if (push.failureReason === 'no-anchor') {
    return `push rejeitado (non-fast-forward) e este card nao tem push anterior nem PR registrado para provar que a branch remota e dele — reexecutar sozinho NAO resolve. Inspecione o historico remoto da branch e, se for mesmo deste card, apague-a no remoto para o motor recriar: ${push.detail}`
  }
  if (push.failureReason === 'diverged') {
    return `push recusado mesmo com --force-with-lease ancorado no ultimo push que este card conhece — a branch remota mudou desde entao (fixup humano ou outro processo); reexecutar sozinho NAO resolve, decida manualmente: ${push.detail}`
  }
  return `push falhou por um motivo que nao e non-fast-forward — reexecutar sozinho tende a repetir esta falha; confira autenticacao/permissao: ${push.detail}`
}

export async function handleFinish(id: string, deps: FinishDeps = { runStep, runCodefoxGate }): Promise<void> {
  const card = readCard(id)
  if (!card) return
  if (CARD_BUDGET_USD > 0 && (parseFloat(card.fm.cost_usd || '0') || 0) > CARD_BUDGET_USD) {
    patchCard(id, { status: 'HALTED' }, `${isoNow()} URL_OK->HALTED orcamento excedido (US$${card.fm.cost_usd} > US$${CARD_BUDGET_USD}) antes do polimento — decida se continua`)
    return
  }
  warnBudgetWithoutGuarantee(id, card.fm, CARD_BUDGET_USD)
  const repoName = card.fm.repo ?? ''
  const slug = card.fm.slug ?? ''
  const target = repoPath(repoName)
  const base = repoBase(repoName)
  const branch = card.fm.branch || `hicode/${id}-${slug}`
  const wt = card.fm.worktree || worktreePath(target, id, slug)
  const msg = `feat: ${card.fm.title ?? ''} (#${id})`
  if (!existsSync(wt)) {
    patchCard(id, { status: 'HALTED' }, `${isoNow()} URL_OK->HALTED worktree ausente: ${wt}`)
    return
  }
  const resumeFrom = card.fm.resume_from ?? ''
  if (resumeFrom) patchCard(id, { resume_from: '' }, `${isoNow()} retomando finish a partir de ${resumeFrom}`)
  const desc = objetivoComInstrucoes(card.body, card.fm.title ?? '')
  const preflight = podeAbrirPr(target, repoName)
  if (preflight.severidade === 'erro') {
    patchCard(id, { status: 'HALTED' }, `${isoNow()} URL_OK->HALTED preflight: ${preflight.detalhe}${preflight.conserto ? ` — conserto: ${preflight.conserto}` : ''} (nada foi gasto no polimento)`)
    process.stdout.write(`[runner] #${id}: HALTED preflight — ${preflight.detalhe}\n`)
    return
  }
  const contract = ensureContract(target, isoNow())
  const changed = (await runGit(wt, ['diff', '--name-only', `origin/${base}...HEAD`])).stdout.split('\n').filter(Boolean)
  const pkg = affectedPackage(contract, changed)
  const ctx: RunCtx = { contract, pkg, target, arquivos: changed }
  patchCard(id, {}, `${isoNow()} contrato: ${contract.stack}${pkg ? ` · pacote afetado: ${pkg.name}` : ''}`)

  // BSS / Pilar 3: ferramenta de teste e de debug no momento em que a area
  // nasce, nao depois. So vale para area NOVA — todo arquivo do diff foi
  // criado. Card que toca codigo existente nao paga esse pedagio, senao todo
  // trabalho num repo legado travaria aqui para sempre.
  const criados = (await runGit(wt, ['diff', '--name-only', '--diff-filter=A', `origin/${base}...HEAD`])).stdout.split('\n').filter(Boolean)
  if (changed.length > 0 && criados.length === changed.length) {
    const setup = conferirSetup(wt, contract)
    patchCard(id, { setup_ferramental: setup.pronto ? 'ok' : 'incompleto' }, `${isoNow()} BSS (area nova): ${relatoDoSetup(setup)}`)
    // Barra so por falta de COMANDO DE TESTE, e so com rigor estrito ligado.
    // Falta de documento de debug e julgamento, nao criterio de bloqueio.
    if (setup.semTeste && rigorEstrito()) {
      patchCard(id, { status: 'HALTED' }, `${isoNow()} CLEANED->HALTED area nova sem comando de teste no contrato do alvo`)
      process.stdout.write(`[runner] #${id}: HALTED — area nova sem comando de teste\n`)
      return
    }
  }
  const all = activeSteps(wt)
  // LEI antes de decidir os passos: a guarda olha o DIFF, nao o que o card
  // declarou. `risk` e escrito no card, e quem escreve o card muitas vezes e a
  // propria IA — subdeclarar risco pulava gate. So SOBE o rigor, nunca baixa.
  const lei = avaliarDiff(changed)
  const plan = aplicarLei(
    planSteps({ title: card.fm.title, objetivo: desc, risk: card.fm.risk, surface: card.fm.surface, override: card.fm.steps }, all),
    lei,
    all,
  )
  const steps = plan.steps
  if (lei.motivos.length) {
    patchCard(id, { lei_forcou: 'completo' }, `${isoNow()} LEI: rigor elevado a completo pelo diff, independente do que o card declarou — ${lei.motivos.join(' · ')}`)
    process.stdout.write(`[runner] #${id}: LEI elevou o rigor (${lei.motivos.length} motivo(s))\n`)
  }
  patchCard(id, { steps_profile: plan.profile }, `${isoNow()} analise de passos: perfil "${plan.profile}" — roda [${steps.map(s => s.label).join(', ') || 'nenhum'}]${plan.skipped.length ? ` · pula [${plan.skipped.join(', ')}]` : ''} (${plan.reason})`)
  const startIdx = resumeStart(steps, all, resumeFrom, id, plan.profile)
  process.stdout.write(`[runner] #${id}: finalizando (perfil ${plan.profile}: ${steps.length} passo(s)${plan.skipped.length ? `, pulou ${plan.skipped.length}` : ''})${resumeFrom ? ` a partir de ${resumeFrom}` : ''}\n`)
  const fsteps: StepMap = {}
  for (const step of steps.slice(startIdx)) {
    const instruction = step.instruction.replace('%s', desc ?? '')
    let r: { time: number; cost: number; costMeasured?: boolean; tokens: number; text: string }
    let gateDoPasso: StepMetric | null = null
    if (step.gated) {
      const g = await runGatedStep(id, wt, base, step.agent, instruction, desc ?? '', step.label, { runStep: deps.runStep, runGatedReview })
      r = { ...g.metric, text: g.text }
      gateDoPasso = g.metricaDoGate
      if (!g.ok) {
        fsteps[step.label] = g.metric
        if (g.metricaDoGate.cost || g.metricaDoGate.tokens) fsteps[step.label + SUFIXO_DO_GATE] = g.metricaDoGate
        if (g.failureClass) {
          applyStepFailurePolicy(id, card, fsteps, {
            fromStatus: step.label,
            resumeStatus: 'URL_OK',
            resumeStep: step.label,
            provider: g.provider ?? '',
            failureClass: g.failureClass,
            failureReason: g.failureReason ?? 'falha nao classificada',
            technicalDetail: g.reason,
          })
          return
        }
        haltForInspection(id, card, fsteps, `${isoNow()} ${step.label}->HALTED gate crivo reprovou apos ${maxReajuste()} reajuste(s): ${g.reason}`)
        return
      }
    } else {
      const sr = await deps.runStep(wt, step.agent, instruction, id)
      if (!sr.ok) {
        fsteps[step.label] = { time: sr.time, cost: sr.cost, tokens: sr.tokens, costMeasured: sr.costMeasured }
        applyStepFailurePolicy(id, card, fsteps, {
          fromStatus: step.label,
          resumeStatus: 'URL_OK',
          resumeStep: step.label,
          provider: sr.provider ?? '',
          failureClass: sr.failureClass ?? 'terminal',
          failureReason: sr.failureReason ?? 'falha nao classificada',
          technicalDetail: `agente ${step.agent}: ${sr.text}`,
        })
        return
      }
      r = { time: sr.time, cost: sr.cost, costMeasured: sr.costMeasured, tokens: sr.tokens, text: sr.text }
    }
    fsteps[step.label] = { time: r.time, cost: r.cost, tokens: r.tokens, costMeasured: r.costMeasured }
    if (gateDoPasso && (gateDoPasso.cost || gateDoPasso.tokens)) fsteps[step.label + SUFIXO_DO_GATE] = gateDoPasso
    if (step.gate === 'test') {
      // CHG / item 5: no perfil completo, o teste tem de ter FALHADO antes de
      // passar. A evidencia vem do diario, nao do relato do modelo.
      const red = exigirRedAntesDoGreen(id, plan.profile)
      if (red.exigido) {
        patchCard(id, { red_antes_do_green: red.satisfeito ? 'sim' : 'nao' }, `${isoNow()} CHG: ${red.motivo}`)
        if (!red.satisfeito && rigorEstrito()) {
          patchCard(id, { status: 'HALTED' }, `${isoNow()} ${step.label}->HALTED ${red.motivo}`)
          process.stdout.write(`[runner] #${id}: HALTED — sem RED antes do GREEN\n`)
          return
        }
      }
    }
    if (step.gate === 'test' && !(await testGate(id, wt, ctx, fsteps, step.label, deps.runStep))) {
      haltForInspection(id, card, fsteps, `${isoNow()} ${step.label}->HALTED testes falharam apos reajuste(s)`)
      return
    }
    const custoDoGate = gateDoPasso?.cost ?? 0
    const detalheDoGate = gateDoPasso ? ` + crivo $${custoDoGate.toFixed(4)}` : ''
    patchCard(id, { status: step.state, wait_attempts: '' }, `${isoNow()} ${step.label} (${step.agent})${step.gated ? ' [crivo ok]' : ''}: ${r.text || 'ok'} (agente $${r.cost.toFixed(4)}${detalheDoGate} · ${r.tokens + (gateDoPasso?.tokens ?? 0)} tokens)`)
    process.stdout.write(`[runner] #${id}: ${step.label} (${step.agent}) $${r.cost.toFixed(4)}\n`)
  }
  if (!(await buildWithReajuste(id, wt, ctx, fsteps, 'Testes', 'Reajuste', deps.runStep))) {
    haltForInspection(id, card, fsteps, `${isoNow()} build->HALTED build falhou apos reajuste(s)`)
    return
  }
  await commitAll(wt, `chore: qualidade Nexus (#${id})`)
  const sync = await syncWithBase(id, wt, base, desc ?? '', fsteps, deps.runStep)
  if (!sync.ok) {
    haltForInspection(id, card, fsteps, `${isoNow()} CLEANED->HALTED conflito com ${base} nao resolvido apos ${MAX_CONFLICT}x (precisa de voce)`)
    process.stdout.write(`[runner] #${id}: HALTED conflito com ${base}\n`)
    return
  }
  if (sync.changed) {
    if (!(await buildWithReajuste(id, wt, ctx, fsteps, 'Conflito', 'Conflito', deps.runStep))) {
      haltForInspection(id, card, fsteps, `${isoNow()} CLEANED->HALTED build falhou apos merge com ${base}`)
      return
    }
    await commitAll(wt, `chore: integra ${base} (#${id})`)
  }
  if (!(await revalidate(id, card, wt, target, fsteps))) {
    haltForInspection(id, card, fsteps, `${isoNow()} CLEANED->HALTED revalidacao falhou pos-merge: objetivo nao confirmado (worktree + url mantidos p/ inspecao)`)
    process.stdout.write(`[runner] #${id}: HALTED revalidacao (pos-merge)\n`)
    return
  }
  const gate = await withGateRetry(
    () => deps.runCodefoxGate(wt, base, desc ?? '', id),
    reason => patchCard(id, {}, `${isoNow()} codefox gate final: NAO EXECUTOU (${reason}) — repetindo antes de decidir`),
  )
  addMetric(fsteps, 'Codefox', { time: 0, cost: gate.cost, tokens: gate.tokens, costMeasured: gate.costMeasured })
  persistGate(id, gate)
  if (gateOutcome(gate) === 'halt') {
    if (!gate.ok && gate.failureClass) {
      applyStepFailurePolicy(id, card, fsteps, {
        fromStatus: 'REVIEWED',
        resumeStatus: 'URL_OK',
        resumeStep: RESUME_POST_STEPS,
        provider: gate.provider ?? '',
        failureClass: gate.failureClass,
        failureReason: gate.failureReason ?? 'falha nao classificada',
        technicalDetail: gateHaltReason(gate),
      })
      process.stdout.write(`[runner] #${id}: codefox gate final nao concluiu (classificado)\n`)
      return
    }
    haltForInspection(id, card, fsteps, `${isoNow()} REVIEWED->HALTED ${gateHaltReason(gate)} (worktree mantido p/ inspecao)`)
    process.stdout.write(`[runner] #${id}: HALTED ${gate.ok ? 'codefox gate BLOCKED' : 'codefox gate nao concluiu'}\n`)
    return
  }
  updateRunSteps(id, fsteps)
  const totalsFields = accumulatedTotals(card, fsteps)
  const donoComprovado = !!String(card.fm.pr_url ?? '').trim()
  const push = await pushOwnedBranch(wt, branch, String(card.fm.pushed_sha ?? '').trim(), donoComprovado)
  if (!push.ok) {
    const diagnostico = pushFailureDiagnostico(push)
    patchCard(id, { status: 'HALTED', ...totalsFields }, `${isoNow()} CLEANED->HALTED ${diagnostico} (worktree mantido p/ inspecao)`)
    return
  }
  patchCard(id, { pushed_sha: push.pushedSha }, push.forced
    ? `${isoNow()} push: a branch remota tinha uma tentativa anterior deste mesmo card — sobrescrita com --force-with-lease ancorado no ultimo push conhecido`
    : `${isoNow()} push: branch atualizada`)
  const body = buildPrBody(id, desc ?? '', gate)
  const prExistente = String(card.fm.pr_url ?? '').trim()
  if (pularCriacaoDePr(prExistente)) {
    patchCard(id, {}, `${isoNow()} PR ja aberto para esta branch — push atualizou ${prExistente}`)
  }
  // Abrir PR e efeito externo irreversivel: passa por SLV. O guarda antigo era
  // so `card.fm.pr_url`, gravado DEPOIS do gh e depois de remover o worktree —
  // morrer nesse meio deixava pr_url vazio, o reconcileStranded devolvia o card
  // para URL_OK e o finish abria um SEGUNDO PR. Agora o diario registra a url
  // no instante em que o gh devolve, antes de qualquer outra coisa.
  let erroDoGh = ''
  const abertura = await executarComIdempotencia({
    card: id,
    fase: 'ctr',
    operacao: 'pr_create',
    executar: async (): Promise<string> => {
      if (prExistente) return prExistente
      const pr = await run('gh', ['pr', 'create', '--repo', repoName, '--base', base, '--head', branch, '--title', msg, '--body', body], { cwd: wt, timeout: 60000 })
      const saida = String(pr.stdout || '').trim().split('\n').filter(Boolean).pop() || ''
      if (pr.err && !saida) erroDoGh = String(pr.stderr || '').slice(0, 120)
      return saida
    },
  })
  const url = abertura.resultado
  if (abertura.reaproveitada && url) {
    patchCard(id, {}, `${isoNow()} PR ja constava no diario de execucao (${url}) — nao foi aberto de novo`)
  }
  if (!url) {
    patchCard(id, { status: 'HALTED', ...totalsFields }, `${isoNow()} CLEANED->HALTED gh pr create falhou (push ja OK — so falta abrir o PR): ${erroDoGh}`)
    return
  }
  stopUrl(card.fm.url_pid)
  await removeWorktree(target, wt)
  patchCard(id, {
    status: 'PR_OPEN',
    pr_url: url,
    wait_attempts: '',
    ...totalsFields,
  }, `${isoNow()} REVIEWED->PR_OPEN ${url} (merge e do humano)`)
  if (PROJECT_MEMORY) appendProjectMemory(target, `#${id} "${(desc ?? '').slice(0, 80)}" -> PR aberto (${url})`)
  process.stdout.write(`[runner] #${id}: PR_OPEN ${url}\n`)
}
