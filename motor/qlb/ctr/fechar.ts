import { existsSync } from 'node:fs'
import { objetivoComInstrucoes } from '../../mir/instruir.ts'
import { isoNow } from '../../cdl/index.ts'
import type { StepMap, StepMetric } from '../../cdl/index.ts'
import { MAX_CONFLICT, maxReajuste, PROJECT_MEMORY } from '../../cdl/ali/config.ts'
import { gastoDoCard, tetoDoCard } from '../../euc/tsr/orcamento.ts'
import { registrarTier, tierDoCard } from '../../osw/rui.ts'
import { appendProjectMemory } from '../../csd/memoria.ts'
import { readCard, patchCard, repoPath, repoBase } from '../../cdl/store.ts'
import { warnBudgetWithoutGuarantee } from '../../euc/tsr/confianca.ts'
import { pushOwnedBranch, removeWorktree, runGit, stageAll, worktreePath } from '../git.ts'
import { abrirPrUmaVez, pularCriacaoDePr } from './pr.ts'
import type { PushResult } from '../git.ts'
import { stopUrl } from '../../cic/crv/url-viva.ts'
import { activeSteps } from '../../nmy/config.ts'
import { aplicarLei, planSteps } from '../../osw/rta/perfil.ts'
import { SUFIXO_DO_GATE, runGatedStep } from '../../cic/passo-com-gate.ts'
import { updateRunSteps } from '../../euc/registros.ts'
import { runCodefoxGate, runGatedReview, persistGate, buildPrBody, gateOutcome, gateHaltReason, withGateRetry } from '../../cic/crv/gate.ts'
import { ensureContract } from '../../cdl/bss/armazenar.ts'
import { podeAbrirPr } from '../../euc/rdr/doctor.ts'
import { affectedPackage } from '../../mir/comandos.ts'
import { packsDoCard } from '../../mir/comandos-manuais.ts'
import { addMetric, accumulatedTotals, haltForInspection, applyStepFailurePolicy } from '../../euc/metricas-de-fecho.ts'
import { buildWithReajuste, testGate } from '../../cic/crv/portoes-de-fecho.ts'
import type { RunCtx } from '../../cic/crv/portoes-de-fecho.ts'
import { syncWithBase, revalidate } from './sync.ts'
import { resumeStart, RESUME_POST_STEPS } from './retomar.ts'
import { runStep } from '../../cic/agente.ts'
import { avaliarDiff } from '../../csd/lei/guarda.ts'
import { rigorEstrito } from '../../cdl/ali/config.ts'
import { conferirSetup, ehAreaNova, relatoDoSetup } from '../../cdl/bss/setup-ferramental.ts'
import { exigirRedAntesDoGreen } from '../../agentes/chg/red-primeiro.ts'
import { contratoPublicoMudou, relatoDeContrato } from '../../agentes/clr/doc-updater.ts'

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
  const teto = tetoDoCard()
  const gasto = gastoDoCard(card.fm.cost_usd)
  if (gasto === null) {
    patchCard(id, { status: 'HALTED' }, `${isoNow()} ${card.fm.status ?? 'URL_OK'}->HALTED cost_usd=${JSON.stringify(card.fm.cost_usd)} nao e numero — tratar isso como "gastou 0" liberaria o polimento pago sem saber o que o card ja custou`)
    return
  }
  if (teto > 0 && gasto > teto) {
    patchCard(id, { status: 'HALTED' }, `${isoNow()} ${card.fm.status ?? 'URL_OK'}->HALTED orcamento excedido (US$${card.fm.cost_usd} > US$${teto}) antes do polimento — decida se continua`)
    return
  }
  warnBudgetWithoutGuarantee(id, card.fm, teto)
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
  // O diff e a ENTRADA de tudo o que vem depois: a LEI (que so SOBE rigor), a
  // deteccao de area nova e o contrato publico. `err` descartado fazia
  // `origin/<base>` ausente virar diff VAZIO em silencio, e dai avaliarDiff([])
  // nunca elevava o rigor (a LEI virava no-op), ehAreaNova devolvia false e o card
  // ganhava "contrato_publico: estavel" como fato positivo derivado de zero dado.
  const diffNomes = await runGit(wt, ['diff', '--name-only', `origin/${base}...HEAD`])
  if (diffNomes.err) {
    patchCard(id, { status: 'HALTED' }, `${isoNow()} ${card.fm.status ?? 'URL_OK'}->HALTED nao consegui LER o diff vs origin/${base} — sem ele a LEI, a checagem de area nova e o contrato publico decidiriam sobre zero dado: ${String(diffNomes.stderr || '').split('\n').filter(Boolean)[0]?.slice(0, 160) ?? diffNomes.err.message}`)
    return
  }
  const changed = diffNomes.stdout.split('\n').filter(Boolean)
  const pkg = affectedPackage(contract, changed)
  const ctx: RunCtx = { contract, pkg, target, arquivos: changed }
  patchCard(id, {}, `${isoNow()} contrato: ${contract.stack}${pkg ? ` · pacote afetado: ${pkg.name}` : ''}`)

  // BSS / Pilar 3: ferramenta de teste e de debug no momento em que a area
  // nasce, nao depois. So vale para area NOVA — todo arquivo do diff foi
  // criado. Card que toca codigo existente nao paga esse pedagio, senao todo
  // trabalho num repo legado travaria aqui para sempre.
  const diffCriados = await runGit(wt, ['diff', '--name-only', '--diff-filter=A', `origin/${base}...HEAD`])
  if (diffCriados.err) {
    patchCard(id, { status: 'HALTED' }, `${isoNow()} ${card.fm.status ?? 'URL_OK'}->HALTED nao consegui listar os arquivos CRIADOS vs origin/${base}, e sem isso "area nova" seria um palpite: ${String(diffCriados.stderr || '').split('\n').filter(Boolean)[0]?.slice(0, 160) ?? diffCriados.err.message}`)
    return
  }
  const criados = diffCriados.stdout.split('\n').filter(Boolean)
  if (ehAreaNova(changed, criados)) {
    const setup = conferirSetup(wt, contract)
    patchCard(id, { setup_ferramental: setup.pronto ? 'ok' : 'incompleto' }, `${isoNow()} BSS (area nova): ${relatoDoSetup(setup)}`)
    // Barra so por falta de COMANDO DE TESTE, e so com rigor estrito ligado.
    // Falta de documento de debug e julgamento, nao criterio de bloqueio.
    if (setup.semTeste && rigorEstrito()) {
      // Este bloco roda ANTES de qualquer passo do pipeline: o card ainda esta em
      // URL_OK, e a etiqueta "CLEANED->HALTED" narrava uma transicao a partir de
      // um estado em que ele nunca esteve.
      patchCard(id, { status: 'HALTED' }, `${isoNow()} ${card.fm.status ?? 'URL_OK'}->HALTED area nova sem comando de teste no contrato do alvo`)
      process.stdout.write(`[runner] #${id}: HALTED — area nova sem comando de teste\n`)
      return
    }
  }
  // Terceiro `git diff` do trecho, e o unico que ainda descartava `err`. O sinal de
  // export de contratoPublicoMudou roda sobre o TEXTO: diff que estoura o maxBuffer
  // ou o timeout devolve err com stdout truncado, e o card gravava
  // "contrato_publico: estavel" — fato positivo sobre dado parcial.
  const diffCompleto = await runGit(wt, ['diff', `origin/${base}...HEAD`])
  if (diffCompleto.err) {
    patchCard(id, { contrato_publico: 'indeterminado' }, `${isoNow()} CLR: NAO consegui ler o diff completo (${String(diffCompleto.stderr || '').split('\n').filter(Boolean)[0]?.slice(0, 140) ?? diffCompleto.err.message}) — nao afirmo nada sobre o contrato publico`)
  }
  const diffTexto = diffCompleto.err ? '' : diffCompleto.stdout
  const contratoPublico = contratoPublicoMudou({ arquivos: changed, diff: diffTexto })
  if (!diffCompleto.err) {
    patchCard(id, { contrato_publico: contratoPublico.mudou ? 'mudou' : 'estavel' }, `${isoNow()} CLR: ${relatoDeContrato(contratoPublico)}`)
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
  // O estado de onde o card sai daqui e o do ULTIMO step que vai rodar — nao uma
  // string fixa. Com perfil enxuto (ou pipeline sem os passos de polimento) o card
  // chega ao fecho ainda em URL_OK, e a etiqueta fixa mentia no diario. Calculado
  // AQUI, e nao la embaixo, porque as etiquetas de HALT do meio do caminho tambem
  // precisam dele.
  if (lei.motivos.length) {
    patchCard(id, { lei_forcou: 'completo' }, `${isoNow()} LEI: rigor elevado a completo pelo diff, independente do que o card declarou — ${lei.motivos.join(' · ')}`)
    process.stdout.write(`[runner] #${id}: LEI elevou o rigor (${lei.motivos.length} motivo(s))\n`)
  }
  patchCard(id, { steps_profile: plan.profile }, `${isoNow()} analise de passos: perfil "${plan.profile}" — roda [${steps.map(s => s.label).join(', ') || 'nenhum'}]${plan.skipped.length ? ` · pula [${plan.skipped.join(', ')}]` : ''} (${plan.reason})`)
  const startIdx = resumeStart(steps, all, resumeFrom, id, plan.profile)
  // O estado de onde o card sai daqui e o do ULTIMO step que VAI DE FATO RODAR.
  // Nao e `steps.at(-1)`: numa retomada com `resume_from` os passos ja feitos sao
  // pulados, e com RESUME_POST_STEPS nenhum roda — o card fica onde estava, e a
  // etiqueta apontava para um estado em que ele nunca esteve nesta execucao.
  const vaoRodar = steps.slice(startIdx)
  const statusAtual = vaoRodar.at(-1)?.state ?? String(card.fm.status ?? 'URL_OK')
  process.stdout.write(`[runner] #${id}: finalizando (perfil ${plan.profile}: ${steps.length} passo(s)${plan.skipped.length ? `, pulou ${plan.skipped.length}` : ''})${resumeFrom ? ` a partir de ${resumeFrom}` : ''}\n`)
  const fsteps: StepMap = {}
  for (const step of steps.slice(startIdx)) {
    registrarTier(id, step.id, tierDoCard(step.id, { leiForcou: lei.forca === 'completo', pedidoDoCard: card.fm.tier }))
    const instruction = step.instruction.replace('%s', desc ?? '')
    let r: { time: number; cost: number; costMeasured?: boolean; tokens: number; text: string }
    let gateDoPasso: StepMetric | null = null
    if (step.gated) {
      const g = await runGatedStep(id, wt, base, ctx.target, step.agent, instruction, desc ?? '', step.label, { runStep: deps.runStep, runGatedReview }, packsDoCard(card.fm.packs))
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
        // A frase nao pode atribuir ao CRIVO uma reprovacao que ele nao emitiu:
        // esgotar tentativas por falha do agente chega aqui tambem, e agora vem
        // classificado (o bloco acima trata) — este caminho e o BLOCKED de verdade.
        haltForInspection(id, card, fsteps, `${isoNow()} ${step.label}->HALTED o crivo reprovou apos ${maxReajuste()} reajuste(s): ${g.reason}`)
        return
      }
    } else {
      const sr = await deps.runStep(wt, step.agent, instruction, id, ctx.target, packsDoCard(card.fm.packs))
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
    if (step.gate === 'test' && !(await testGate(id, wt, ctx, fsteps, step.label, deps.runStep))) {
      haltForInspection(id, card, fsteps, `${isoNow()} ${step.label}->HALTED testes falharam apos reajuste(s)`)
      return
    }
    if (step.gate === 'test') {
      // CHG / item 5: no perfil completo, o teste tem de ter FALHADO antes de
      // passar. A evidencia vem do diario, nao do relato do modelo.
      //
      // A consulta roda DEPOIS de testGate, e nao antes, porque o unico produtor da
      // evidencia e registrarRed — que vive DENTRO de testGate
      // (motor/cic/crv/portoes-de-fecho.ts:97). Enquanto a ordem era a inversa,
      // red.satisfeito era constante false: com HICODE_RIGOR_ESTRITO=1 todo card
      // 'completo' fazia HALT mesmo com TDD real, e desligado o campo gravava 'nao'
      // sempre — o campo que PENDENCIAS.md chama de "insumo para decidir quando
      // apertar" era uma constante.
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
  const sync = await syncWithBase(id, wt, base, ctx.target, desc ?? '', fsteps, deps.runStep)
  if (!sync.ok) {
    // `sync.detail` era dado morto: o HALT dizia sempre "conflito com <base> nao
    // resolvido apos Nx", entao fetch quebrado ou merge que NAO e conflito viravam
    // diagnostico falso de conflito E contagem falsa de tentativas que nunca
    // aconteceram. Quem classifica e o syncWithBase; aqui so se relata.
    haltForInspection(id, card, fsteps, `${isoNow()} ${statusAtual}->HALTED nao integrei ${base}: ${sync.detail || `conflito nao resolvido apos ${MAX_CONFLICT}x`} (precisa de voce)`)
    process.stdout.write(`[runner] #${id}: HALTED nao integrei ${base} — ${sync.detail || 'conflito'}\n`)
    return
  }
  if (sync.changed) {
    if (!(await buildWithReajuste(id, wt, ctx, fsteps, 'Conflito', 'Conflito', deps.runStep))) {
      haltForInspection(id, card, fsteps, `${isoNow()} ${statusAtual}->HALTED build falhou apos merge com ${base}`)
      return
    }
    await commitAll(wt, `chore: integra ${base} (#${id})`)
  }
  if (!(await revalidate(id, card, wt, target, fsteps))) {
    haltForInspection(id, card, fsteps, `${isoNow()} ${statusAtual}->HALTED revalidacao falhou pos-merge: objetivo nao confirmado (worktree + url mantidos p/ inspecao)`)
    process.stdout.write(`[runner] #${id}: HALTED revalidacao (pos-merge)\n`)
    return
  }
  // O tier 'review' de config/model-tier.json descrevia o step `review` do
  // pipeline, removido: o veredito dele nunca era lido e ele custava uma chamada
  // de agente COM escrita habilitada. Quem faz a revisao adversarial e este gate,
  // que LE o diff — entao e ele que registra o tier, senao o criterio de
  // governanca fica em disco sem nada em execucao para governar.
  registrarTier(id, 'review', tierDoCard('review', { leiForcou: lei.forca === 'completo', pedidoDoCard: card.fm.tier }))
  const gate = await withGateRetry(
    () => deps.runCodefoxGate(wt, base, desc ?? '', id),
    reason => patchCard(id, {}, `${isoNow()} codefox gate final: NAO EXECUTOU (${reason}) — repetindo antes de decidir`),
  )
  addMetric(fsteps, 'Codefox', { time: 0, cost: gate.cost, tokens: gate.tokens, costMeasured: gate.costMeasured })
  persistGate(id, gate)
  if (gateOutcome(gate) === 'halt') {
    if (!gate.ok && gate.failureClass) {
      applyStepFailurePolicy(id, card, fsteps, {
        fromStatus: statusAtual,
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
    haltForInspection(id, card, fsteps, `${isoNow()} ${statusAtual}->HALTED ${gateHaltReason(gate)} (worktree mantido p/ inspecao)`)
    process.stdout.write(`[runner] #${id}: HALTED ${gate.ok ? 'codefox gate BLOCKED' : 'codefox gate nao concluiu'}\n`)
    return
  }
  updateRunSteps(id, fsteps)
  const totalsFields = accumulatedTotals(card, fsteps)
  const donoComprovado = !!String(card.fm.pr_url ?? '').trim()
  const push = await pushOwnedBranch(wt, branch, String(card.fm.pushed_sha ?? '').trim(), donoComprovado)
  if (!push.ok) {
    const diagnostico = pushFailureDiagnostico(push)
    patchCard(id, { status: 'HALTED', ...totalsFields }, `${isoNow()} ${statusAtual}->HALTED ${diagnostico} (worktree mantido p/ inspecao)`)
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
  // As duas guardas contra o SEGUNDO PR vivem em abrirPrUmaVez (motor/qlb/ctr/pr.ts),
  // com `executar` injetavel — sem isso a guarda so era verificavel por leitura de
  // texto-fonte.
  const abertura = await abrirPrUmaVez({
    card: id, repoName, base, branch, titulo: msg, corpo: body, worktree: wt, prExistente,
  })
  const erroDoGh = abertura.erro
  const url = abertura.url
  if (abertura.reaproveitada && url) {
    patchCard(id, {}, `${isoNow()} PR ja constava no diario de execucao (${url}) — nao foi aberto de novo`)
  }
  if (!url) {
    patchCard(id, { status: 'HALTED', ...totalsFields }, `${isoNow()} ${statusAtual}->HALTED gh pr create falhou (push ja OK — so falta abrir o PR): ${erroDoGh}`)
    return
  }
  stopUrl(card.fm.url_pid)
  await removeWorktree(target, wt)
  patchCard(id, {
    status: 'PR_OPEN',
    pr_url: url,
    wait_attempts: '',
    ...totalsFields,
  }, `${isoNow()} ${statusAtual}->PR_OPEN ${url} (merge e do humano)`)
  if (PROJECT_MEMORY) appendProjectMemory(target, `#${id} "${(desc ?? '').slice(0, 80)}" -> PR aberto (${url})`)
  process.stdout.write(`[runner] #${id}: PR_OPEN ${url}\n`)
}
