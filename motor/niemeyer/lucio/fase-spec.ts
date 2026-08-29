import { existsSync } from 'node:fs'
import { objetivoComInstrucoes } from '../../mirante/instruir.ts'
import { isoNow } from '../../cordel/index.ts'
import { maxReajuste } from '../../cordel/alicerce/config.ts'
import { readCard, patchCard, repoPath, repoBase } from '../../cordel/store.ts'
import { ensureWorktree, runGit, stageAll, worktreePath } from '../../quilombo/git.ts'
import { runStep } from '../../ciclo/agente.ts'
import { gastoDoCard, tetoDoCard } from '../../euclides/tesouro/orcamento.ts'
import { openspecAvailable, initOpenspec, validateChange } from './openspec.ts'
import type { SpecValidation } from './openspec.ts'

function specPrompt(name: string, desc: string, feedback: string): string {
  return [
    `Crie/ajuste um OpenSpec change chamado "${name}" em openspec/changes/${name}/ para a tarefa abaixo.`,
    'Estrutura: proposal.md (secoes "## Why" e "## What Changes"), tasks.md ("## 1. ..." com itens "- [ ]"), e specs/<capability>/spec.md.',
    'No spec.md: "## ADDED Requirements" -> "### Requirement: <nome>" com uma frase NORMATIVA contendo MUST ou SHALL -> "#### Scenario: <nome>" com linhas "- **WHEN** ..." e "- **THEN** ...".',
    'Cada Requirement PRECISA de ao menos 1 Scenario e da palavra MUST ou SHALL. NAO rode git.',
    feedback ? `\nCORRIJA estes erros de validacao do openspec: ${feedback}` : '',
    '',
    'TAREFA:',
    desc,
  ].join('\n')
}

// Deps injetaveis pelo mesmo motivo que handleFinish/handleCorrect/handleExecute:
// a fase decide HALT por causa de custo e de falha de agente, e sem a costura isso
// so era verificavel subindo openspec e um provedor de verdade — ou seja, nao era.
export interface SpecDeps {
  runStep: typeof runStep
  openspecAvailable: typeof openspecAvailable
  initOpenspec: typeof initOpenspec
  validateChange: typeof validateChange
  ensureWorktree: typeof ensureWorktree
}

const DEPS_PADRAO: SpecDeps = { runStep, openspecAvailable, initOpenspec, validateChange, ensureWorktree }

export async function handleSpec(id: string, deps: SpecDeps = DEPS_PADRAO): Promise<void> {
  const card = readCard(id)
  if (!card) return
  const repoName = card.fm.repo ?? ''
  const slug = card.fm.slug ?? ''
  const target = repoPath(repoName)
  if (!existsSync(target)) {
    patchCard(id, { status: 'HALTED' }, `${isoNow()} SPECCED->HALTED repo nao encontrado: ${target}`)
    return
  }
  const base = repoBase(repoName)
  const branch = card.fm.branch || `hicode/${id}-${slug}`
  const wt = card.fm.worktree || worktreePath(target, id, slug)
  patchCard(id, { branch, worktree: wt }, `${isoNow()} SPECCED: preparando worktree para o spec`)
  try {
    const info = await deps.ensureWorktree(target, wt, branch, base)
    patchCard(id, { base_commit: info.baseCommit }, `${isoNow()} base: branch criada de origin/${base}@${info.baseCommit}`)
  } catch (e) {
    patchCard(id, { status: 'HALTED' }, `${isoNow()} SPECCED->HALTED ${String((e as Error)?.message ?? e).slice(0, 140)}`)
    return
  }
  if (!(await deps.openspecAvailable())) {
    patchCard(id, { status: 'EXECUTING', spec_done: 'true' }, `${isoNow()} SPECCED->EXECUTING openspec ausente — fase de spec pulada`)
    return
  }
  if (!(await deps.initOpenspec(wt))) patchCard(id, {}, `${isoNow()} spec: openspec init retornou erro (seguindo mesmo assim)`)
  const name = `card-${id}`
  const desc = objetivoComInstrucoes(card.body, card.fm.title ?? '')
  let v: SpecValidation = { ok: false, failed: 1, issues: ['spec nao gerado'] }
  let attempt = 0
  // O retorno de runStep era descartado INTEIRO. Duas consequencias, as duas
  // silenciosas: (a) falha do agente (provedor nao-agentico, timeout, cota) nao
  // era vista, o laco queimava as tentativas e o card HALTava dizendo "spec
  // reprovado no openspec validate" — causa FALSA, porque o spec nunca chegou a
  // ser gerado; (b) custo e tokens da fase nunca eram somados ao card, entao o
  // gasto do spec ficava invisivel para tetoDoCard().
  // `gastoDoCard`, nao `parseFloat(... || '0') || 0`: o segundo faz cost_usd
  // corrompido virar 0 e — pior — este bloco GRAVA o total de volta no card, o que
  // apagaria a evidencia de corrupcao e desarmaria as guardas de
  // executar/corrigir/fechar para sempre.
  const gastoAnterior = gastoDoCard(card.fm.cost_usd)
  if (gastoAnterior === null) {
    patchCard(id, { status: 'HALTED' }, `${isoNow()} SPECCED->HALTED cost_usd=${JSON.stringify(card.fm.cost_usd)} nao e numero — nao vou gastar na fase de spec sem saber o que o card ja custou`)
    return
  }
  const tetoDoSpec = tetoDoCard()
  if (tetoDoSpec > 0 && gastoAnterior > tetoDoSpec) {
    patchCard(id, { status: 'HALTED' }, `${isoNow()} SPECCED->HALTED orcamento excedido (US$${gastoAnterior.toFixed(4)} > US$${tetoDoSpec}) antes da fase de spec — decida se continua`)
    return
  }
  let custoUsd = gastoAnterior
  let tokens = Number(card.fm.tokens_total || '0') || 0
  let falhaDoAgente = ''
  while (attempt <= maxReajuste()) {
    const r = await deps.runStep(wt, 'glossia', specPrompt(name, desc, attempt === 0 ? '' : v.issues.slice(0, 5).join('; ')), id, target)
    custoUsd += r.cost
    tokens += r.tokens
    patchCard(id, { cost_usd: custoUsd.toFixed(4), tokens_total: String(tokens) },
      `${isoNow()} spec (glossia): ${r.ok ? r.text || 'ok' : `NAO CONCLUIU — ${r.failureReason ?? r.failureClass ?? 'sem detalhe'}`} (agente $${r.cost.toFixed(4)} · ${r.tokens} tokens${r.costMeasured ? '' : ', custo NAO medido'})`)
    // A fase ACUMULA custo, entao o teto tem de ser conferido a cada volta: sem
    // isso o laco de reajuste podia passar do orcamento antes de alguem olhar.
    if (tetoDoSpec > 0 && custoUsd > tetoDoSpec) {
      patchCard(id, { status: 'HALTED' }, `${isoNow()} SPECCED->HALTED orcamento excedido na fase de spec (US$${custoUsd.toFixed(4)} > US$${tetoDoSpec}) — decida se continua`)
      return
    }
    if (!r.ok) {
      falhaDoAgente = `${r.failureReason ?? r.failureClass ?? 'sem detalhe'}: ${r.text}`.slice(0, 200)
      break
    }
    v = await deps.validateChange(wt, name)
    patchCard(id, {}, `${isoNow()} spec (glossia) openspec validate: ${v.ok ? 'valido' : `invalido[${v.failed}] ${v.issues.slice(0, 3).join('; ')}`}`)
    if (v.ok) break
    attempt++
  }
  if (falhaDoAgente) {
    patchCard(id, { status: 'HALTED' }, `${isoNow()} SPECCED->HALTED o agente do spec NAO concluiu — o spec nunca foi gerado, entao nao houve validacao nenhuma: ${falhaDoAgente} (worktree mantido p/ inspecao)`)
    return
  }
  if (!v.ok) {
    patchCard(id, { status: 'HALTED' }, `${isoNow()} SPECCED->HALTED spec reprovado no openspec validate --strict apos ${maxReajuste()} reajuste(s): ${v.issues.slice(0, 3).join('; ')} (worktree mantido p/ inspecao)`)
    return
  }
  await stageAll(wt)
  const cm = await runGit(wt, ['-c', 'commit.gpgsign=false', 'commit', '-m', `spec: openspec change ${name} (#${id})`])
  if (cm.err && !/nothing to commit|nada a submeter/i.test(String(cm.stdout || cm.stderr || ''))) {
    const motivo = String(cm.stderr || cm.stdout || '').split('\n')[0] ?? ''
    patchCard(id, { status: 'HALTED' }, `${isoNow()} SPECCED->HALTED commit do spec falhou: ${motivo} (worktree mantido p/ inspecao)`)
    return
  }
  patchCard(id, { status: 'EXECUTING', spec_done: 'true' }, `${isoNow()} SPECCED->EXECUTING (plano aprovado: openspec validate --strict passou; spec commitado)`)
}
