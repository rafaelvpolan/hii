import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isoNow } from '../../cordel/index.ts'
import type { Card, StepMap } from '../../cordel/index.ts'
import { MAX_CONFLICT } from '../../cordel/alicerce/config.ts'
import { patchCard } from '../../cordel/store.ts'
import { abortarMergeSeComecou, classeDeFalhaDeMerge, runGit, withGitLock } from '../git.ts'
import { runStep } from '../../ciclo/agente.ts'
import { ensureUrl, hasDevServer, httpOk, inspectUrl, urlPort, waitHttp } from '../../ciclo/crivo/url-viva.ts'
import { isNonVisual } from '../../oswaldo/rota/superficie.ts'
import { addMetric } from '../../euclides/metricas-de-fecho.ts'
import { anexarEvento } from '../../euclides/eventos.ts'

// O laco de conflito tem semantica propria e por isso NAO usa repararAteOTeto:
// GateReparavel modela "roda verificacao -> veredicto -> conserto estreito", e
// resolucao de conflito nao tem verificacao re-executavel — o veredicto e o
// proprio `git diff --diff-filter=U` e o conserto edita os arquivos em conflito.
// Forcar no molde compraria uniformidade pagando com abstracao errada.
//
// O que faltava era mais estreito: ele escrevia no log do card e registrava
// metrica, mas nao emitia evento nenhum. Sem evento, recuperar.ts nao enxerga um
// laco interrompido por crash e o aprendiz nao consegue contar conflito
// recorrente como padrao.

export interface SyncResult {
  ok: boolean
  changed: boolean
  detail?: string
}

export const FASE_DO_CONFLITO = 'conflito'

const MARCADORES = /^(<{7}|={7}|>{7})/m

async function arquivosComMarcador(wt: string, files: string[]): Promise<string[]> {
  const comMarcador: string[] = []
  for (const f of files) {
    try {
      if (MARCADORES.test(readFileSync(join(wt, f), 'utf8'))) comMarcador.push(f)
    } catch (e) {
      // Arquivo AUSENTE e resolucao legitima de conflito delete/modify: o agente
      // removeu o arquivo, ou usou `git rm`. Contar como "ainda com marcador"
      // fazia o laco nunca fechar, esgotar MAX_CONFLICT e abortar dizendo que ha
      // marcador de conflito num arquivo que nao existe mais.
      if ((e as { code?: string }).code === 'ENOENT') continue
      comMarcador.push(f)
    }
  }
  return comMarcador
}

export async function syncWithBase(id: string, wt: string, base: string, alvo: string, desc: string, fsteps: StepMap, executar: typeof runStep = runStep): Promise<SyncResult> {
  // O resultado do fetch era DESCARTADO: fetch que falha nao interrompia nada, o
  // merge rodava contra um `origin/<base>` velho (ou inexistente) e o card
  // recebia "sync: integrou origin/main (ja atualizado)" — afirmacao falsa de
  // sincronia no instante antes do fecho e do PR.
  const f = await withGitLock(() => runGit(wt, ['fetch', 'origin', base]))
  if (f.err) {
    return { ok: false, changed: false, detail: `fetch origin/${base} falhou — NAO da para afirmar sincronia com a base: ${String(f.stderr || '').split('\n').filter(Boolean)[0]?.slice(0, 160) ?? f.err.message}` }
  }
  const before = (await runGit(wt, ['rev-parse', 'HEAD'])).stdout.trim()
  const merge = await runGit(wt, ['merge', '--no-edit', `origin/${base}`])
  if (!merge.err) {
    const after = (await runGit(wt, ['rev-parse', 'HEAD'])).stdout.trim()
    const changed = before !== after
    patchCard(id, {}, `${isoNow()} sync: integrou origin/${base}${changed ? ' sem conflito' : ' (ja atualizado)'}`)
    return { ok: true, changed }
  }
  // SEGUNDO sitio de `git merge` do motor. Enquanto ele nao usava o classificador,
  // toda falha caia no laco de conflito: `--diff-filter=U` vinha vazio, o limpio
  // recebia "Resolva os conflitos nestes arquivos: " com lista VAZIA, o motor
  // gastava ate MAX_CONFLICT chamadas pagas e o diario afirmava um conflito que
  // nunca existiu.
  const saidaDoMerge = `${merge.stdout}\n${merge.stderr}`
  const classe = classeDeFalhaDeMerge(saidaDoMerge)
  const primeiraLinhaDoMerge = String(saidaDoMerge).split('\n').map(l => l.trim()).filter(Boolean)[0]?.slice(0, 160) ?? 'git nao explicou'
  // `err` conferido aqui tambem, e nao so na consulta do topo do laco: se ESTA
  // falhar, stdout vem '' e a lista vazia produzia a causa FALSA "nao ha arquivo em
  // conflito para resolver" — que vai literal para o HALT que o humano le.
  const listaU = await runGit(wt, ['diff', '--name-only', '--diff-filter=U'])
  if (listaU.err) {
    return {
      ok: false,
      changed: false,
      detail: `${classe} ao integrar origin/${base}, e nao consegui listar os arquivos em conflito para saber o que pedir (${String(listaU.stderr || '').split('\n').filter(Boolean)[0]?.slice(0, 120) ?? listaU.err.message})${await abortarMergeSeComecou(wt)}`,
    }
  }
  const emConflito = listaU.stdout.split('\n').filter(Boolean)
  if (!emConflito.length) {
    // `abortarMergeSeComecou`, e nao `merge --abort` cru: o abort so faz sentido se
    // havia MERGE_HEAD, e abort que FALHA deixa o worktree no meio do merge — o
    // aviso disso vinha nos outros tres sitios e faltava neste.
    const sujo = await abortarMergeSeComecou(wt)
    return {
      ok: false,
      changed: false,
      detail: `${classe} ao integrar origin/${base} — nao ha arquivo em conflito para resolver, entao nao ha o que pedir ao agente: ${primeiraLinhaDoMerge}${sujo}`,
    }
  }
  let attempt = 0
  let ultimoPendente = ''
  while (attempt < MAX_CONFLICT) {
    attempt++
    // `err` conferido AQUI, e nao so na consulta de dentro do if: se esta falhar
    // (index.lock de outro processo git — caso que o proprio classificador nomeia),
    // `files` vinha [] e o agente era chamado, PAGO, com "Resolva os conflitos
    // nestes arquivos: " vazio. A guarda que existia agia depois do gasto.
    const emU = await runGit(wt, ['diff', '--name-only', '--diff-filter=U'])
    if (emU.err) {
      return { ok: false, changed: true, detail: `nao consegui listar os arquivos em conflito (${String(emU.stderr || '').split('\n').filter(Boolean)[0]?.slice(0, 120) ?? emU.err.message}) — nao vou pagar uma chamada de agente com a lista vazia${await abortarMergeSeComecou(wt)}` }
    }
    const files = emU.stdout.split('\n').filter(Boolean)
    if (!files.length) {
      return { ok: false, changed: true, detail: `git nao lista arquivo em conflito nesta volta — nao vou pedir ao agente para resolver lista vazia${await abortarMergeSeComecou(wt)}` }
    }
    const tr = Date.now()
    const rr = await executar(wt, 'limpio', `Conflito de merge ao integrar origin/${base} na branch. Resolva os conflitos nestes arquivos: ${files.join(', ')}. Preserve o objetivo "${desc}" E as mudancas de ${base}. Remova TODOS os marcadores de conflito (<<<<<<<, =======, >>>>>>>). Nao rode git.`, id, alvo)
    addMetric(fsteps, 'Conflito', { time: Math.round((Date.now() - tr) / 1000), cost: rr.cost, tokens: rr.tokens, costMeasured: rr.costMeasured })
    const marcadores = await arquivosComMarcador(wt, files)
    const naoExecutou = rr.ok ? '' : `o agente nao concluiu: ${(rr.text || 'sem detalhe').slice(0, 120)}`
    const pendente = naoExecutou || (marcadores.length ? `marcador de conflito ainda em ${marcadores.join(', ')}` : '')
    ultimoPendente = pendente
    anexarEvento({ card: id, evento: 'repair_attempt', fase: FASE_DO_CONFLITO, detalhe: `${attempt}/${MAX_CONFLICT}: ${pendente || 'resolvido'}` })
    patchCard(id, {}, `${isoNow()} CONFLITO (${attempt}/${MAX_CONFLICT}, limpio): ${rr.text || 'resolveu'} — ${pendente || 'resolvido'}`)
    process.stdout.write(`[runner] #${id}: CONFLITO ${attempt} (limpio)\n`)
    if (!pendente) {
      // `files` vazio DA SEGUNDA VOLTA em diante nao e "resolvido": `git add` num
      // arquivo conflitado limpa o estado U mesmo com marcador em disco, e a
      // consulta pode ter falhado com `err` descartado. Sem esta guarda, o codigo
      // declarava resolvido e commitava sem inspecionar marcador nenhum.
      if (!files.length) {
        return { ok: false, changed: true, detail: `git nao lista mais arquivo em conflito, mas nada foi conferido nesta volta — nao declaro resolvido sobre lista vazia${await abortarMergeSeComecou(wt)}` }
      }
      await runGit(wt, ['add', ...files])
      const aindaU = await runGit(wt, ['diff', '--name-only', '--diff-filter=U'])
      if (aindaU.err) {
        return { ok: false, changed: true, detail: `nao consegui conferir se sobrou conflito (${String(aindaU.stderr || '').split('\n').filter(Boolean)[0]?.slice(0, 120) ?? aindaU.err.message})${await abortarMergeSeComecou(wt)}` }
      }
      if (aindaU.stdout.trim()) continue
      const cm = await runGit(wt, ['-c', 'commit.gpgsign=false', 'commit', '--no-edit'])
      if (cm.err) {
        anexarEvento({ card: id, evento: 'gate_verdict', fase: FASE_DO_CONFLITO, detalhe: 'falhou: commit da resolucao nao passou' })
        return { ok: false, changed: false, detail: `commit da resolucao falhou: ${String(cm.stderr || '').split('\n')[0] ?? ''}` }
      }
      anexarEvento({ card: id, evento: 'gate_verdict', fase: FASE_DO_CONFLITO, detalhe: 'ok: conflito resolvido' })
      return { ok: true, changed: true }
    }
  }
  anexarEvento({ card: id, evento: 'gate_verdict', fase: FASE_DO_CONFLITO, detalhe: `falhou: teto de ${MAX_CONFLICT} tentativas de resolucao esgotado` })
  const sujo = await abortarMergeSeComecou(wt)
  // `detail` obrigatorio tambem aqui: quem chama (fechar.ts) usa exatamente este
  // texto no HALT. Devolver undefined fazia o chamador cair no texto genérico e a
  // classificacao morrer no caminho.
  return {
    ok: false,
    changed: true,
    detail: `conflito com ${base} nao resolvido apos ${MAX_CONFLICT} tentativa(s) do agente — ${ultimoPendente || 'marcador de conflito ainda no worktree'}${sujo}`,
  }
}

export async function revalidate(id: string, card: Card, wt: string, target: string, fsteps: StepMap): Promise<boolean> {
  if (isNonVisual(card.fm.surface)) {
    patchCard(id, { revalidacao: 'n/a' }, `${isoNow()} revalidacao pulada — tarefa nao-visual (build/testes ja validaram)`)
    return true
  }
  let ok = true
  let reason = 'sem dev server (revalidacao pulada)'
  const rt = Date.now()
  if (hasDevServer(target)) {
    const rport = urlPort(id)
    const rurl = `http://localhost:${rport}`
    let up = await httpOk(rurl)
    if (!up) {
      await ensureUrl(wt, rport, target)
      up = await waitHttp(rurl, 25)
    }
    if (up) {
      const h = await inspectUrl(id, rurl, true)
      if (!h.conclusive) {
        reason = `url no ar apos merge — verificacao humana (inspecao automatica indisponivel${h.detail ? ': ' + h.detail : ''})`
      } else {
        ok = h.ok
        reason = h.ok ? 'url no ar apos merge — confira pelo link' : `url com erro: ${h.detail}`
      }
    } else {
      reason = 'dev server nao respondeu (revalidacao pulada)'
    }
  }
  addMetric(fsteps, 'Revalidacao', { time: Math.round((Date.now() - rt) / 1000), cost: 0, tokens: 0 })
  patchCard(id, { revalidacao: ok ? 'ok' : 'falhou' }, `${isoNow()} revalidacao do projeto (vs objetivo, pos-merge): ${ok ? 'OK' : 'FALHOU'} — ${reason}`)
  return ok
}
