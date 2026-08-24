import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { extractObjetivo, isoNow } from '../cdl/index.ts'
import type { Card, Fields, ImplementResult, StepMap, StepMetric, Usage } from '../cdl/index.ts'
import { cardsDir, CLARIFY, EVAL, quotaFallbackLigado, VERIFY_MODEL, VISUAL_AI } from '../cdl/ali/config.ts'
import { gastoDoCard, tetoDoCard } from '../euc/tsr/orcamento.ts'
import { clarify, clarifyPorIdeacao, writeClarify } from '../agentes/clr/clarificar.ts'
import { planSteps } from './rta/perfil.ts'
import { activeSteps } from '../nmy/config.ts'
import { evaluate } from '../cic/crv/avaliar.ts'
import { readCard, patchCard, repoPath, repoBase } from '../cdl/store.ts'
import { ensureWorktree, refreshFromBase, runGit, settleWorktree, stageAll, worktreeOnBranch, worktreePath } from '../qlb/git.ts'
import type { WorktreeFate } from '../qlb/git.ts'
import { ensureUrl, hasDevServer, inspectUrl, urlPort, stopUrl } from '../cic/crv/url-viva.ts'
import { classifySurface, pedeUrl, type SurfaceVerdict } from './rta/superficie.ts'
import { instrucaoDeAjuste, instrucaoDeConserto, relatoDoAjuste, subirUrlComAjuste, esperarPorPid, subirNoWorktree } from '../cic/rpr/url-ajuste.ts'
import { escopoDoCard, implement, verifyVisual } from '../cic/agente.ts'
import { foraDoEscopo } from './rta/escopo.ts'
import { resolvedFailure, writeRun } from '../euc/registros.ts'
import { abrirSessao } from '../euc/ias-da-sessao.ts'
import { warnBudgetWithoutGuarantee } from '../euc/tsr/confianca.ts'
import { applyFailurePolicy } from '../cic/rpr/politica.ts'
import { quotaFallbackProviderFor } from '../tmd/registro.ts'

export interface ExecuteDeps {
  implement: typeof implement
  verifyVisual: typeof verifyVisual
  inspecionar?: typeof inspectUrl
}

interface ExecuteSteps {
  Fila: StepMetric
  Executando: StepMetric
  Feito: StepMetric
  Url: StepMetric
  Aprovado: StepMetric
  Arquitetura: StepMetric
  Testes: StepMetric
  Seguranca: StepMetric
  Review: StepMetric
  Limpeza: StepMetric
  Reajuste: StepMetric
  Revalidacao: StepMetric
}

function zeroMetric(): StepMetric {
  return { time: 0, cost: 0, tokens: 0 }
}

function toSeconds(ms: number): number {
  return Math.round(ms / 1000)
}

function tokensOf(u: Usage | undefined): number {
  return u ? (u.tokens_in || 0) + (u.tokens_out || 0) + (u.tokens_cache_create || 0) : 0
}

function initialSteps(): ExecuteSteps {
  return {
    Fila: zeroMetric(),
    Executando: zeroMetric(),
    Feito: zeroMetric(),
    Url: zeroMetric(),
    Aprovado: zeroMetric(),
    Arquitetura: zeroMetric(),
    Testes: zeroMetric(),
    Seguranca: zeroMetric(),
    Review: zeroMetric(),
    Limpeza: zeroMetric(),
    Reajuste: zeroMetric(),
    Revalidacao: zeroMetric(),
  }
}

function asStepMap(steps: ExecuteSteps): StepMap {
  return { ...steps }
}

function resolveSurface(card: Card, target: string): SurfaceVerdict {
  const explicit = card.fm.surface
  if (explicit === 'visual' || explicit === 'api' || explicit === 'none') return { surface: explicit, reason: 'definido no card' }
  return classifySurface(card.fm.title ?? '', extractObjetivo(card.body), hasDevServer(target))
}

export interface Conserto {
  vstate: string
  vreason: string
  custo: number
  tokens: number
}

export async function consertarUmaVez(id: string, card: Card, wt: string, url: string, detalhe: string, deps: ExecuteDeps): Promise<Conserto> {
  const inspecionar = deps.inspecionar ?? inspectUrl
  process.stdout.write(`[runner] #${id}: pagina com erro — tentando consertar uma vez\n`)
  patchCard(id, {}, `${isoNow()} url com erro (${detalhe}) — uma tentativa automatica de conserto antes de chamar voce`)
  const r = await deps.implement(card, wt, instrucaoDeConserto(detalhe), false)
  const custo = parseFloat(r.cost || '0') || 0
  const tokens = tokensOf(r.usage)
  if (!r.ok) {
    return { vstate: 'falhou', vreason: `url subiu com erro (${detalhe}) e a tentativa de conserto falhou — precisa de voce`, custo, tokens }
  }
  const depois = await inspecionar(id, url, true)
  if (depois.conclusive && depois.ok) {
    return { vstate: 'ok', vreason: `url subiu com erro e o motor consertou: ${r.resultText || 'conserto aplicado'}`, custo, tokens }
  }
  const sobrou = depois.detail || detalhe
  return { vstate: 'falhou', vreason: `url ainda com erro depois de uma tentativa de conserto (${sobrou}) — precisa de voce`, custo, tokens }
}

// `git diff --name-only HEAD` NAO lista arquivo novo (untracked) — e o commit
// depois usa `git add -A`, entao um arquivo CRIADO dentro da referencia entrava no
// PR sem passar pela checagem de escopo. `status --porcelain` ve rastreado,
// nao-rastreado e renomeado.
// Parse PURO da saida de `status --porcelain -z`, separado da chamada do git para
// poder ser testado nos codigos que a tabela do `git help status` documenta e que
// nao sao triviais de produzir num repo de teste (R na segunda coluna).
export function tocadosDoPorcelain(saidaZ: string): string[] {
  const campos = saidaZ.split('\0').filter(Boolean)
  const saida: string[] = []
  for (let i = 0; i < campos.length; i++) {
    const linha = campos[i] ?? ''
    if (linha.length < 4) continue
    const x = linha[0] ?? ''
    const y = linha[1] ?? ''
    saida.push(linha.slice(3))
    // Rename/copy gasta DOIS campos: `R  novo\0antigo\0`. O antigo tambem foi
    // tocado — sair de dentro da referencia e mexer nela.
    //
    // R/C aparecem em QUALQUER das duas colunas: a tabela do `git help status` lista
    // "renamed in index" (R na 1a) e "renamed in work tree" (R na 2a, com a 1a
    // vazia). Olhar so a primeira nao era so perder o campo antigo: o campo extra
    // seguia na fila e virava a "linha" da iteracao seguinte, entao `slice(3)`
    // cortava tres caracteres do caminho e TODO o resto da saida saia deslocado — a
    // checagem de escopo ficava cega para os arquivos seguintes.
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      const antigo = campos[++i]
      if (antigo) saida.push(antigo)
    }
  }
  return saida
}

export async function tocadosNoWorktree(wt: string): Promise<string[]> {
  // `:!node_modules` casa o que `stageAll` de fato commita (qlb/git.ts). Sem isto,
  // em alvo onde node_modules nao esta ignorado, `-uall` enumera a arvore inteira:
  // estoura o maxBuffer do execFile (a checagem falharia ABERTA, em silencio, so no
  // repo grande) e enche `escopo_violado` de arquivos que nem seriam commitados.
  const r = await runGit(wt, ['status', '--porcelain', '-z', '--untracked-files=all', '--', '.', ':!node_modules'])
  return tocadosDoPorcelain(r.stdout)
}

async function commitAndRecord(id: string, wt: string, card: Card, steps: ExecuteSteps, res: ImplementResult, t0: number): Promise<{ costSum: number; tokensTotal: number }> {
  const tf = Date.now()
  await stageAll(wt)
  const cm = await runGit(wt, ['-c', 'commit.gpgsign=false', 'commit', '-m', `feat: ${card.fm.title ?? ''} (#${id})`])
  if (cm.err && !/nothing to commit|nada a submeter/i.test(String(cm.stdout || cm.stderr || ''))) {
    throw new Error(`commit da implementacao falhou: ${String(cm.stderr || cm.stdout || '').split('\n')[0] ?? ''}`)
  }
  steps.Feito.time = toSeconds(Date.now() - tf)
  const costSum = steps.Executando.cost + steps.Url.cost
  const rec = writeRun(id, { ...res, cost: costSum.toFixed(4) }, toSeconds(Date.now() - t0), asStepMap(steps))
  return { costSum, tokensTotal: rec.tokens_total }
}

export async function handleExecute(id: string, deps: ExecuteDeps = { implement, verifyVisual }): Promise<void> {
  const card = readCard(id)
  if (!card) return
  abrirSessao(id)
  const gastoLido = gastoDoCard(card.fm.cost_usd)
  if (gastoLido === null) {
    patchCard(id, { status: 'HALTED' }, `${isoNow()} EXECUTING->HALTED cost_usd=${JSON.stringify(card.fm.cost_usd)} nao e numero — "gastou 0" liberaria a (re)execucao paga sem saber o que o card ja custou`)
    return
  }
  const baseCost = gastoLido
  const baseTokens = Number(card.fm.tokens_total || '0') || 0
  const teto = tetoDoCard()
  if (teto > 0 && baseCost > teto) {
    patchCard(id, { status: 'HALTED' }, `${isoNow()} EXECUTING->HALTED orcamento excedido (US$${card.fm.cost_usd} > US$${teto}) antes de (re)executar — decida se continua`)
    return
  }
  warnBudgetWithoutGuarantee(id, card.fm, teto)
  let auxCost = 0
  let auxTokens = 0
  const repoName = card.fm.repo ?? ''
  const slug = card.fm.slug ?? ''
  const target = repoPath(repoName)
  if (!existsSync(target)) {
    patchCard(id, { status: 'HALTED' }, `${isoNow()} EXECUTING->HALTED repo nao encontrado: ${target}`)
    return
  }
  const surface = resolveSurface(card, target)
  if (card.fm.surface !== surface.surface) {
    patchCard(id, { surface: surface.surface }, `${isoNow()} classificacao previa: tarefa ${surface.surface.toUpperCase()} (${surface.reason})`)
  }
  if (CLARIFY && card.fm.clarified !== 'true') {
    const perfilPrevio = planSteps(
      { title: card.fm.title, objetivo: extractObjetivo(card.body), risk: card.fm.risk, surface: surface.surface, override: card.fm.steps },
      activeSteps(),
    ).profile
    const ide = await clarifyPorIdeacao(card, perfilPrevio)
    auxCost += ide.cost
    auxTokens += ide.tokens
    if (ide.perguntas.length) {
      writeClarify(id, ide.perguntas)
      patchCard(id, { status: 'CLARIFY', cost_usd: (baseCost + auxCost).toFixed(4), tokens_total: String(baseTokens + auxTokens) }, `${isoNow()} EXECUTING->CLARIFY ideacao divergente (${ide.motivo}) — escolha a abordagem`)
      process.stdout.write(`[runner] #${id}: CLARIFY por ideacao (${ide.motivo})\n`)
      return
    }
    if (ide.motivo) patchCard(id, {}, `${isoNow()} ideacao: pulada — ${ide.motivo}`)
    const c = await clarify(card)
    auxCost += c.cost || 0
    auxTokens += c.tokens || 0
    if (c.questions.length) {
      writeClarify(id, c.questions)
      patchCard(id, { status: 'CLARIFY', cost_usd: (baseCost + auxCost).toFixed(4), tokens_total: String(baseTokens + auxTokens) }, `${isoNow()} EXECUTING->CLARIFY ${c.questions.length} pergunta(s) — aguardando decisao humana`)
      process.stdout.write(`[runner] #${id}: CLARIFY (${c.questions.length} pergunta(s))\n`)
      return
    }
    if (c.falhou) {
      patchCard(id, {}, `${isoNow()} clarify: pulado — ${c.falhou} (nao marquei a tarefa como clara; a pergunta continua pendente)`)
    } else {
      patchCard(id, { clarified: 'true' }, `${isoNow()} clarify: tarefa clara — seguindo sem perguntas`)
    }
  }
  if (card.fm.spec === 'required' && card.fm.spec_done !== 'true') {
    patchCard(id, { status: 'SPECCED' }, `${isoNow()} EXECUTING->SPECCED roteado para a fase de spec (spec: required)`)
    return
  }
  const base = repoBase(repoName)
  const branch = card.fm.branch || `hicode/${id}-${slug}`
  const wt = card.fm.worktree || worktreePath(target, id, slug)
  patchCard(id, { branch, worktree: wt }, `${isoNow()} EXECUTING: preparando worktree ${branch}`)
  try {
    const reuse = card.fm.spec_done === 'true' && await worktreeOnBranch(wt, branch)
    if (card.fm.spec_done === 'true' && !reuse) {
      patchCard(id, { status: 'SPECCED', spec_done: '' }, `${isoNow()} EXECUTING->SPECCED worktree do spec ausente — regerando spec`)
      return
    }
    if (reuse) {
      await runGit(wt, ['reset', '--hard', 'HEAD'])
      await runGit(wt, ['clean', '-fd', '-e', 'node_modules'])
      const up = await refreshFromBase(wt, base)
      if (!up.ok) {
        patchCard(id, { status: 'HALTED' }, `${isoNow()} EXECUTING->HALTED nao consegui partir de ${base} atualizado: ${up.detail}`)
        return
      }
      patchCard(id, {}, `${isoNow()} base: ${up.detail} (worktree do spec reaproveitado)`)
    } else {
      const info = await ensureWorktree(target, wt, branch, base)
      patchCard(id, { base_commit: info.baseCommit }, `${isoNow()} base: branch criada de origin/${base}@${info.baseCommit}`)
    }
  } catch (e) {
    patchCard(id, { status: 'HALTED' }, `${isoNow()} EXECUTING->HALTED ${String((e as Error)?.message ?? e).slice(0, 140)}`)
    return
  }
  process.stdout.write(`[runner] #${id}: implementando em worktree ${wt}\n`)
  const port = urlPort(id)
  let urlPid = 0
  if (pedeUrl(surface.surface) && hasDevServer(target)) {
    const h = await ensureUrl(wt, port, target, card.fm.url_pid)
    urlPid = h.pid
    patchCard(id, { url: `http://localhost:${port}`, url_pid: String(urlPid) }, `${isoNow()} url ${h.reused ? 'reaproveitado (ja estava no ar)' : 'subindo'} em http://localhost:${port} — acompanhe pelo link enquanto a IA trabalha`)
    process.stdout.write(`[runner] #${id}: url ${h.reused ? 'reaproveitado' : 'ao vivo'} em http://localhost:${port}\n`)
  }
  const t0 = Date.now()
  const shotPath = join(cardsDir(), 'urls', String(id), 'url.png')
  const steps = initialSteps()
  const tx = Date.now()
  // Escopo lido ANTES do implement, contra o worktree INTACTO. Lido depois, o
  // agente que APAGA o diretorio de referencia desligava a propria checagem: sem
  // o caminho em `referencias`, foraDoEscopo curto-circuita para [].
  const escopo = escopoDoCard(card, wt)
  // Grava no card para a TUI poder MOSTRAR o escopo enquanto a tarefa roda: escopo
  // que so existe no prompt do agente e invisivel para quem acompanha.
  if (escopo.alvos.length || escopo.referencias.length) {
    patchCard(id, { escopo_alvos: escopo.alvos.join(', '), escopo_refs: escopo.referencias.join(', ') },
      `${isoNow()} escopo lido do pedido: ${escopo.motivo}`)
  }
  const res = await deps.implement(card, wt, '', surface.surface === 'visual')
  steps.Executando.time += toSeconds(Date.now() - tx)
  steps.Executando.cost += parseFloat(res.cost) || 0
  steps.Executando.tokens += tokensOf(res.usage)
  if (!res.ok) {
    const elapsed = toSeconds(Date.now() - t0)
    const { failureClass, failureReason } = resolvedFailure(res)
    const rec = writeRun(id, { ...res, failureClass, failureReason }, elapsed, asStepMap(steps))
    const totalCost = baseCost + auxCost + (parseFloat(res.cost || '0') || 0)
    const totalTokens = baseTokens + auxTokens + rec.tokens_total
    const totals: Fields = { cost_usd: totalCost.toFixed(4), tokens_total: String(totalTokens) }
    if (failureClass === 'quota' && quotaFallbackLigado()) {
      const fallback = quotaFallbackProviderFor('implement')
      if (fallback && fallback !== res.provider) {
        patchCard(id, { provider_override_implement: fallback, ...totals }, `${isoNow()} EXECUTING: cota de ${res.provider ?? 'provedor'} esgotada — trocando para ${fallback} (config explicita HICODE_QUOTA_FALLBACK=on) e tentando de novo`)
        return
      }
    }
    const technicalDetail = res.timedOut ? `${res.reason ?? ''} apos ${elapsed}s` : (res.reason ?? '')
    const outcome = applyFailurePolicy({
      id,
      fromStatus: 'EXECUTING',
      resumeStatus: 'EXECUTING',
      provider: res.provider ?? '',
      failureClass,
      failureReason,
      technicalDetail,
      extraFields: totals,
    })
    if (outcome === 'waiting') return
    const fate: WorktreeFate = failureClass === 'transient' ? 'keep-for-inspection' : 'discard'
    if (fate === 'discard' && urlPid) stopUrl(String(urlPid))
    await settleWorktree(target, wt, fate)
    return
  }
  // Sem etiqueta de transicao: esta escrita nao muda o status, so limpa
  // wait_attempts. Anunciar "EXECUTING->EXECUTED" narrava um estado que o card
  // nunca entrou — EXECUTED esta declarado em topologia.json como estado que
  // nenhum arquivo de motor/ escreve, e as duas coisas nao podiam ser verdade.
  // ESCOPO — o cumprimento, e nao a promessa. O prompt do agente diz "escreva
  // somente em X, Y e so leitura"; aqui o motor CONFERE no diff. Sem isto, o
  // escopo seria mais uma instrucao em texto que o modelo pode ignorar — e foi
  // ignorando que ele editou o projeto de referencia.
  //
  // Barra ANTES do polimento e antes de subir url: o gasto para aqui.
  const violou = foraDoEscopo(escopo, await tocadosNoWorktree(wt))
  if (violou.length) {
    // O implement JA gastou. Parar sem lancar o gasto deixaria dinheiro fora do
    // livro — e o teto de orcamento le `cost_usd`, entao o retry seguinte comecaria
    // achando que nada foi gasto. Mesma contabilidade do caminho de falha acima.
    // `res.ok` e true (o implement rodou), mas o card PAROU. Gravar o run como
    // sucesso deixaria a causa fora do ledger: quem le runs/*.json para taxa de
    // sucesso ou para saber por que o card parou nao encontraria nada.
    const rec = writeRun(id, {
      ...res,
      ok: false,
      // 'terminal', nao uma classe nova: nao e transitorio nem cota, e repetir sem
      // mudar o pedido daria o mesmo resultado. A causa vai no motivo.
      failureClass: 'terminal',
      failureReason: `escreveu fora do escopo: ${violou.slice(0, 10).join(', ')}`,
    }, toSeconds(Date.now() - t0), asStepMap(steps))
    patchCard(id, {
      status: 'HALTED',
      // Teto: `escopo_violado` vai para o frontmatter numa linha so. Sem limite, uma
      // violacao em massa (diretorio inteiro) tornaria o card ilegivel.
      escopo_violado: violou.slice(0, 20).join(',') + (violou.length > 20 ? ` +${violou.length - 20}` : ''),
      cost_usd: (baseCost + auxCost + steps.Executando.cost).toFixed(4),
      tokens_total: String(baseTokens + auxTokens + rec.tokens_total),
    },
      `${isoNow()} EXECUTING->HALTED o agente escreveu FORA do escopo: ${violou.join(', ')} — o pedido marcou esses caminhos como referencia (${escopo.motivo}). O worktree fica para inspecao; se a escrita ali era legitima, diga no pedido que o caminho tambem e alvo`)
    process.stdout.write(`[runner] #${id}: HALTED — escreveu fora do escopo: ${violou.join(', ')}\n`)
    return
  }
  patchCard(id, { wait_attempts: '' }, `${isoNow()} EXECUTING: ${res.resultText || 'mudanca aplicada'} (implementacao concluida)`)
  if (surface.surface === 'none') {
    const { costSum, tokensTotal } = await commitAndRecord(id, wt, card, steps, res, t0)
    patchCard(id, {
      status: 'URL',
      url: '',
      verify: 'sem-url',
      cost_usd: (baseCost + costSum + auxCost).toFixed(4),
      tokens_total: String(baseTokens + tokensTotal + auxTokens),
    }, `${isoNow()} EXECUTING->URL sem url — tarefa nao-visual (${surface.reason}); aprovacao de funcionalidade e sua`)
    process.stdout.write(`[runner] #${id}: aguardando aprovacao de funcionalidade (nao-visual)\n`)
    return
  }
  const tpv = Date.now()
  const temDevServer = hasDevServer(target)
  const tentativa = temDevServer
    ? await subirUrlComAjuste({
      subir: subirNoWorktree(wt, port, target),
      responde: esperarPorPid(port),
      ajustar: async (motivo, n) => {
        process.stdout.write(`[runner] #${id}: url ${motivo} — ajustando (${n})\n`)
        const r = await deps.implement(card, wt, instrucaoDeAjuste(port, n), false)
        steps.Url.cost += parseFloat(r.cost) || 0
        steps.Url.tokens += tokensOf(r.usage)
        return r.ok ? `ajuste ${n} aplicado` : `ajuste ${n} falhou`
      },
    }, urlPid ? String(urlPid) : card.fm.url_pid, id)
    : { pid: 0, noAr: false, tentativas: 0, ajustes: [] }
  const pid = tentativa.pid
  const url = pid ? `http://localhost:${port}` : ''
  const up = tentativa.noAr
  steps.Url.time = toSeconds(Date.now() - tpv)
  const { costSum, tokensTotal } = await commitAndRecord(id, wt, card, steps, res, t0)
  const auxAtUrl = auxCost
  // O conserto anterior ficou so no TEXTO do diario: `initState` — que e o campo
  // LIDO (bin/repl.ts) — continuava dando 'inconclusivo' tanto para "o repo nao
  // tem dev server" quanto para "tem, tentei N vezes e nao subiu", enquanto o
  // caso mais brando (subiu e nao respondeu) recebia 'falhou'.
  const initState = !temDevServer ? 'sem-dev-server' : (pid ? (up ? 'inconclusivo' : 'falhou') : 'falhou')
  // A condicao era `!pid`, que confunde duas coisas opostas: "o contrato do alvo
  // nao declara dev server" e "declara, tentei N vezes e nao subiu". A segunda
  // virava a frase da primeira, e o relato das N tentativas ia para o lixo — o
  // humano lia "repo sem dev server" num repo que TEM dev server quebrado.
  const initReason = !temDevServer
    ? 'repo sem dev server no contrato do alvo — verificacao humana pelo link'
    : relatoDoAjuste(tentativa)
  patchCard(id, {
    status: 'URL',
    url: url,
    url_pid: String(pid || ''),
    verify: initState,
    cost_usd: (baseCost + costSum + auxCost).toFixed(4),
    tokens_total: String(baseTokens + tokensTotal + auxTokens),
  }, `${isoNow()} EXECUTING->URL ${url || (temDevServer ? '(dev server NAO subiu)' : '(sem dev server)')} (${initReason})`)
  process.stdout.write(`[runner] #${id}: URL ${url} (${initReason})\n`)
  if (up) {
    const health = await (deps.inspecionar ?? inspectUrl)(id, url, true)
    let vstate = 'inconclusivo'
    let vreason = `url no ar — confira pelo link (inspecao automatica indisponivel${health.detail ? ': ' + health.detail : ''})`
    if (VISUAL_AI && health.ok) {
      const v = await deps.verifyVisual(card, shotPath)
      auxCost += v.cost || 0
      auxTokens += v.tokens || 0
      vstate = v.ok ? 'ok' : 'falhou'
      vreason = `check visual (IA, ${VERIFY_MODEL}): ${v.reason}`
    } else if (health.conclusive) {
      vstate = health.ok ? 'ok' : 'falhou'
      vreason = health.ok ? 'url no ar — abra o link para conferir' : `url subiu com erro: ${health.detail}`
    }
    if (vstate === 'falhou') {
      const conserto = await consertarUmaVez(id, card, wt, url, health.detail || vreason, deps)
      auxCost += conserto.custo
      auxTokens += conserto.tokens
      vstate = conserto.vstate
      vreason = conserto.vreason
    }
    patchCard(id, { verify: vstate }, `${isoNow()} inspecao do url: ${vstate} — ${vreason}`)
    process.stdout.write(`[runner] #${id}: inspecao ${vstate}\n`)
  }
  if (EVAL) {
    const e = await evaluate(card, wt, base)
    auxCost += e.cost || 0
    auxTokens += e.tokens || 0
    if (e.score < 0) {
      patchCard(id, { eval_notes: e.notes }, `${isoNow()} eval NAO rodou — sem nota de qualidade (${e.notes})`)
    } else {
      patchCard(id, { eval_score: String(e.score), eval_notes: e.notes }, `${isoNow()} eval (qualidade vs objetivo): ${e.score}/5 ${e.meets ? '(cumpre)' : '(revisar)'} — ${e.notes}`)
    }
    process.stdout.write(`[runner] #${id}: eval ${e.score}/5\n`)
  }
  if (auxCost !== auxAtUrl) {
    const total = baseCost + costSum + auxCost
    patchCard(id, { cost_usd: total.toFixed(4), tokens_total: String(baseTokens + tokensTotal + auxTokens) }, `${isoNow()} custo atualizado (verificacao/eval): $${total.toFixed(4)}`)
  }
}
