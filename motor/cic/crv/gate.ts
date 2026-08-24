import { isoNow } from '../../cdl/index.ts'
import type { FailureClass } from '../../cdl/index.ts'
import { GATE_DIFF_LIMIT, GATE_RETRIES, GATE_TIMEOUT_MAX_MS, GATE_TIMEOUT_MIN_MS, GATE_TIMEOUT_MS_PER_KB, ROOT } from '../../cdl/ali/config.ts'
import { runGit, stageAll } from '../../qlb/git.ts'
import { patchCard, readCard } from '../../cdl/store.ts'
import { modelFor, providerFor, effortFor } from '../../tmd/registro.ts'
import { runProvider } from '../../euc/tsr/confianca.ts'
import { sumTokens } from '../../tmd/uso.ts'
import { classifyFailure } from '../rpr/classe-de-falha.ts'
import { renderizarCriterios } from './criterios.ts'
import { cegar, MAX_CANDIDATOS_CEGOS, modoDoCrivo, referenciasDoCard, renderizarComparacao, telaDoCard } from '../cnd/gauntlet.ts'
import { skillsPara } from '../../csd/acervo.ts'
import { gauntletLigado } from '../../tmd/preferencias.ts'
import { gastoDoCard } from '../../euc/tsr/orcamento.ts'
import { existsSync } from 'node:fs'

// Derivado de ROTULOS, nao copiado: `cegar()` aceita `MAX_CANDIDATOS_CEGOS`
// candidatos e um deles e sempre a tela do motor. Como copia manual, mudar ROTULOS
// fazia `cegar()` voltar a LANCAR aqui — depois de patchCard ja ter gravado
// crivo_modo:'gauntlet'.
const MAX_REFERENCIAS_NA_COMPARACAO = MAX_CANDIDATOS_CEGOS - 1

export type GateVerdict = 'APPROVED' | 'CONDITIONAL' | 'BLOCKED'

export interface GateResult {
  ok: boolean
  verdict: GateVerdict
  reason: string
  criterio: string
  questions: string[]
  cost: number
  costMeasured: boolean
  tokens: number
  failureClass?: FailureClass
  failureReason?: string
  provider?: string
}

interface RawVerdict {
  verdict?: string
  reason?: string
  // O prompt EXIGE este campo ("id do criterio violado") desde sempre, mas ele nao
  // existia aqui, nao era extraido e nao era gravado. Um BLOCKED sem id nenhum era
  // aceito igual a um com id: na pratica o gate fechava pelo `reason` em texto livre
  // do modelo, que e exatamente o julgamento por impressao que o item 8 aboliu.
  criterio?: string
  questions?: string[]
}

interface DiffParts {
  names: string
  patch: string
  falhou?: string
}

interface ParsedGate {
  found: boolean
  verdict: GateVerdict
  reason: string
  criterio: string
  questions: string[]
  cost: number
  tokens: number
}

function oneLine(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').trim()
}

function normalizeVerdict(v: string): GateVerdict {
  const u = v.trim().toUpperCase()
  if (u === 'BLOCKED' || u === 'APPROVED') return u
  return 'CONDITIONAL'
}

export function extractVerdictJson(text: string): RawVerdict | null {
  const objs: string[] = []
  let depth = 0
  let start = -1
  let inStr = false
  let esc = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') { inStr = true; continue }
    if (ch === '{') { if (depth === 0) start = i; depth++ }
    else if (ch === '}') {
      depth--
      if (depth === 0 && start >= 0) { objs.push(text.slice(start, i + 1)); start = -1 }
    }
  }
  for (let k = objs.length - 1; k >= 0; k--) {
    try {
      const o = JSON.parse(objs[k] ?? '') as RawVerdict
      if (o && typeof o.verdict === 'string') return o
    } catch { void 0 }
  }
  return null
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function timeoutForDiff(diff: DiffParts): number {
  const kb = diff.patch.length / 1024
  return Math.round(clamp(GATE_TIMEOUT_MIN_MS + kb * GATE_TIMEOUT_MS_PER_KB, GATE_TIMEOUT_MIN_MS, GATE_TIMEOUT_MAX_MS))
}

async function accumulatedDiff(wt: string, base: string, working: boolean): Promise<DiffParts> {
  if (working) {
    const st = await stageAll(wt)
    if (st.err) return { names: '', patch: '', falhou: `git add falhou: ${primeiraLinha(st.stderr)}` }
  }
  const range = working ? ['--cached', '--merge-base', `origin/${base}`] : [`origin/${base}...HEAD`]
  const nomes = await runGit(wt, ['diff', '--name-status', ...range])
  if (nomes.err) return { names: '', patch: '', falhou: `git diff --name-status falhou: ${primeiraLinha(nomes.stderr)}` }
  const namesRaw = nomes.stdout.trim()
  const names = namesRaw.length > 4000 ? namesRaw.slice(0, 4000) + '\n[...lista truncada...]' : namesRaw
  const corpo = await runGit(wt, ['diff', ...range])
  if (corpo.err) return { names: '', patch: '', falhou: `git diff falhou: ${primeiraLinha(corpo.stderr)}` }
  const raw = corpo.stdout
  const patch = raw.length > GATE_DIFF_LIMIT ? raw.slice(0, GATE_DIFF_LIMIT) + '\n[...diff truncado...]' : raw
  return { names, patch }
}

function primeiraLinha(texto: string): string {
  return String(texto || '').split('\n').filter(Boolean)[0]?.slice(0, 160) ?? 'sem detalhe'
}

function arquivosDoDiff(names: string): string[] {
  return names.split('\n').map(l => l.split('\t').pop() ?? '').filter(Boolean)
}

function packsAtivos(diff: DiffParts): string[] {
  return [...new Set(skillsPara('avaliador', { arquivos: arquivosDoDiff(diff.names), deps: [] }).map(s => s.pack))]
}

function buildPromptGauntlet(desc: string, tela: string, referencias: readonly string[], id: string): string {
  const candidatos = [
    { origem: 'motor', conteudo: `abra a imagem com a tool Read: ${tela}` },
    ...referencias.map(r => ({ origem: 'referencia', conteudo: `abra a imagem com a tool Read: ${r}` })),
  ]
  return [
    'Voce e o CRIVO em modo GAUNTLET — julgamento de qualidade subjetiva por comparacao, read-only.',
    renderizarComparacao(cegar(candidatos, id)),
    `TAREFA (objetivo do card): "${desc}"`,
    '',
    'Emita 1-3 PERGUNTAS que forcem o revisor humano a OLHAR as telas antes do merge.',
    'Responda APENAS um JSON em uma unica linha, sem prosa antes ou depois:',
    '{"verdict":"APPROVED|CONDITIONAL|BLOCKED","reason":"motivo curto","questions":["p1","p2"]}',
    'BLOCKED apenas quando o resultado fica claramente abaixo do outro candidato. Em duvida, CONDITIONAL.',
  ].join('\n')
}

function buildPrompt(desc: string, diff: DiffParts): string {
  return [
    'Voce e o CRIVO — revisor adversarial read-only. Revise o diff ACUMULADO abaixo (toda a cadeia de alteracoes da branch vs a base) contra a tarefa e o criterio escrito.',
    renderizarCriterios(),
    `TAREFA (objetivo do card): "${desc}"`,
    '',
    `ARQUIVOS ALTERADOS:\n${diff.names}`,
    '',
    `DIFF:\n${diff.patch}`,
    '',
    'Emita 1-3 PERGUNTAS que forcem o revisor humano a LER o diff antes do merge (anti-rendicao-cognitiva) — coisas que so quem leu o diff sabe responder.',
    'Responda APENAS um JSON em uma unica linha, sem prosa antes ou depois:',
    '{"verdict":"APPROVED|CONDITIONAL|BLOCKED","reason":"motivo curto","criterio":"id do criterio violado, ou vazio","questions":["p1","p2"]}',
    'BLOCKED apenas para defeito real/regressao/violacao de alta confianca. Em duvida, CONDITIONAL.',
  ].join('\n')
}

export function buildParsed(text: string, cost: number, tokens: number): ParsedGate {
  const v = extractVerdictJson(text)
  if (v) {
    const questions = Array.isArray(v.questions)
      ? v.questions.map(q => oneLine(String(q)).slice(0, 240)).filter(Boolean).slice(0, 3)
      : []
    return { found: true, verdict: normalizeVerdict(String(v.verdict || 'CONDITIONAL')), reason: oneLine(String(v.reason || '')).slice(0, 240), criterio: oneLine(String(v.criterio || '')).slice(0, 60), questions, cost, tokens }
  }
  return { found: false, verdict: 'CONDITIONAL', reason: '', criterio: '', questions: [], cost, tokens }
}

// `null` de gastoDoCard significa CORROMPIDO, e nao "nao sei": mapear os dois para
// `undefined` fazia a TRAVA 2 nem comparar, e o modo caro iniciava exatamente
// quando o registro de custo esta quebrado — o mesmo fail-open do
// `parseFloat(...) || 0` que este conserto substituiu, e divergente dos tres
// sitios irmaos (executar/corrigir/fechar), que fazem HALT no mesmo input.
//
// `Infinity` e a resposta honesta: "o gasto conhecido nao cabe em nenhum teto",
// entao a trava barra. Card sem id ou inexistente segue sendo `undefined` — ali
// nao ha o que ler.
function gastoConhecido(id: string): number | undefined {
  if (!id) return undefined
  const card = readCard(id)
  if (!card) return undefined
  const gasto = gastoDoCard(card.fm.cost_usd)
  return gasto === null ? Number.POSITIVE_INFINITY : gasto
}

async function gateReview(wt: string, base: string, desc: string, working: boolean, id: string): Promise<GateResult> {
  const diff = await accumulatedDiff(wt, base, working)
  if (diff.falhou) {
    return { ok: false, verdict: 'BLOCKED', reason: `nao consegui LER o diff para revisar — ${diff.falhou}`, criterio: '', questions: [], cost: 0, costMeasured: true, tokens: 0 }
  }
  if (!diff.names.trim()) {
    return { ok: true, verdict: 'APPROVED', reason: 'sem mudancas vs a base', criterio: '', questions: [], cost: 0, costMeasured: true, tokens: 0 }
  }
  const provider = providerFor('gate')
  const todasAsReferencias = referenciasDoCard(id)
  const referencias = todasAsReferencias.slice(0, MAX_REFERENCIAS_NA_COMPARACAO)
  const refsCortadas = todasAsReferencias.length - referencias.length
  const tela = telaDoCard(id)
  const escolha = modoDoCrivo({
    packs: packsAtivos(diff),
    // `cegar()` LANCA acima de 8 candidatos, e `referenciasDoCard` nao tem teto.
    // A excecao escapava DEPOIS de patchCard ja ter gravado crivo_modo:'gauntlet',
    // em vez de cair no criterio escrito como todos os outros elos fazem. O corte
    // acontece antes da decisao para o modo nao ser escolhido com um numero de
    // candidatos que a comparacao cega nao suporta.
    referencias,
    ativado: gauntletLigado(),
    // `undefined` = nao sei quanto foi gasto, e o teto nao pode ser aplicado —
    // que e o que `ContextoDoModo` declara. Coagir card ausente, card ilegivel ou
    // cost_usd corrompido para 0 fazia a TRAVA 2 passar e o modo caro iniciar
    // justamente quando o registro de custo esta quebrado.
    gastoUsd: gastoConhecido(id),
  })
  const podeVer = provider.supportsVision && existsSync(tela)
  const gauntlet = escolha.modo === 'gauntlet' && podeVer
  const avisoDeCorte = refsCortadas > 0
    ? ` (${refsCortadas} referencia(s) a mais ficaram de fora: a comparacao cega suporta ${MAX_REFERENCIAS_NA_COMPARACAO} candidatos com a tela do motor)`
    : ''
  const motivoDoModo = gauntlet
    ? escolha.motivo
    : escolha.modo === 'gauntlet'
      ? `${escolha.motivo}, mas ${provider.supportsVision ? 'o card nao tem tela renderizada' : `${provider.name} nao le imagem`} — cai no criterio escrito`
      : escolha.motivo
  if (id) patchCard(id, { crivo_modo: gauntlet ? 'gauntlet' : 'criterio-escrito' }, `${isoNow()} CND: ${motivoDoModo}${avisoDeCorte}`)
  const res = await runProvider(id, provider, {
    prompt: gauntlet ? buildPromptGauntlet(desc, tela, referencias, id) : buildPrompt(desc, diff),
    cwd: ROOT,
    dirs: gauntlet ? [wt, ...referencias.map(r => r.replace(/\/[^/]+$/, '')), tela.replace(/\/[^/]+$/, '')] : [wt],
    mode: 'readonly',
    useAgents: false,
    model: modelFor('gate'),
    effort: effortFor('gate'),
    timeoutMs: timeoutForDiff(diff),
  }, 'gate')
  const tokens = sumTokens(res.usage)
  if (res.failed) {
    const cls = classifyFailure(provider, { timedOut: res.timedOut, detail: res.detail, text: res.text })
    return { ok: false, verdict: 'CONDITIONAL', reason: `gate NAO executou (${res.timedOut ? 'timeout' : 'erro'}): ${oneLine(res.detail).slice(0, 120)}`, criterio: '', questions: [], cost: res.cost, costMeasured: res.costMeasured, tokens, failureClass: cls.failureClass, failureReason: cls.reason, provider: provider.name }
  }
  const parsed = buildParsed(res.text, res.cost, tokens)
  if (!parsed.found) {
    return { ok: false, verdict: 'CONDITIONAL', reason: 'gate sem veredito parseavel na saida (revisar manualmente)', criterio: '', questions: [], cost: res.cost, costMeasured: res.costMeasured, tokens }
  }
  return { ok: true, verdict: parsed.verdict, reason: parsed.reason, criterio: parsed.criterio, questions: parsed.questions, cost: res.cost, costMeasured: res.costMeasured, tokens }
}

export type GateOutcome = 'halt' | 'proceed'

export function gateOutcome(gate: GateResult): GateOutcome {
  if (!gate.ok) return 'halt'
  return gate.verdict === 'BLOCKED' ? 'halt' : 'proceed'
}

export function gateHaltReason(gate: GateResult): string {
  return gate.ok
    ? `codefox gate BLOCKED: ${gate.reason}`
    : `codefox gate NAO concluiu (nao ha veredito confiavel): ${gate.reason}`
}

export function runCodefoxGate(wt: string, base: string, desc: string, id = ''): Promise<GateResult> {
  return gateReview(wt, base, desc, false, id)
}

export function runGatedReview(wt: string, base: string, desc: string, id = ''): Promise<GateResult> {
  return gateReview(wt, base, desc, true, id)
}

export async function withGateRetry(run: () => Promise<GateResult>, onRetry?: (reason: string) => void): Promise<GateResult> {
  let g = await run()
  for (let retry = 0; !g.ok && retry < GATE_RETRIES; retry++) {
    onRetry?.(g.reason)
    const again = await run()
    g = { ...again, cost: g.cost + again.cost, costMeasured: g.costMeasured && again.costMeasured, tokens: g.tokens + again.tokens }
  }
  return g
}

export function persistGate(id: string, gate: GateResult): void {
  const flag = gate.ok ? '' : ' [gate nao concluido]'
  patchCard(id, {
    // Quando o gate NAO concluiu, o campo grava isso em vez de um veredito que
    // ninguem emitiu. Antes ia 'CONDITIONAL' nos dois casos e o qualificador ficava
    // so na linha de log em texto livre — nenhum campo distinguia "julgou e ficou em
    // duvida" de "nao chegou a julgar".
    review_verdict: gate.ok ? gate.verdict : 'NAO_CONCLUIDO',
    review_reason: oneLine(gate.reason).slice(0, 240),
    review_criterio: gate.criterio,
    review_questions: JSON.stringify(gate.questions),
  }, `${isoNow()} codefox gate: ${gate.verdict}${flag}${gate.criterio ? ` [${gate.criterio}]` : ''} — ${oneLine(gate.reason)} (custo $${gate.cost.toFixed(4)} · ${gate.tokens} tokens)`)
  process.stdout.write(`[runner] #${id}: codefox gate ${gate.verdict}${flag}\n`)
}

export function buildPrBody(id: string, desc: string, gate: GateResult): string {
  const questions = gate.questions.length
    ? '\n\n**Perguntas ao revisor — responda antes do merge:**\n' + gate.questions.map(q => `- [ ] ${oneLine(q)}`).join('\n')
    : ''
  return [
    `Gerado pelo motor hicode (agentes Nexus). Card #${id}.`,
    '',
    (desc || '').slice(0, 500),
    '',
    `**Codefox review:** ${gate.verdict}${gate.ok ? '' : ' (gate nao concluido — revisar manualmente)'} — ${oneLine(gate.reason)}`,
    questions,
  ].join('\n')
}
