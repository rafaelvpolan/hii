import { dirname, join } from 'node:path'
import { objetivoComInstrucoes } from '../mir/instruir'
import { existsSync } from 'node:fs'
import { extractObjetivo } from '../cdl'
import type { Card, FailureClass, ImplementResult, VerifyResult } from '../cdl'
import { cardsDir, ROOT, RUN_TIMEOUT_MS, PROJECT_MEMORY } from '../cdl/ali/config'
import { isProviderName, modelFor, providerFor, effortFor, modoFor } from '../tmd/registro'
import { sumTokens } from '../tmd/uso'
import { classifyFailure } from './rpr/classe-de-falha'
import type { Harness } from '../tmd/tipos'
import { conectorExterno, navegacaoSemantica } from '../tmd/pnt/mcp'
import { agentesNexusPor } from '../agentes/registro'
import type { AgenteInjetado } from '../agentes/registro'
import { readProjectRules } from '../cdl/ali/home'
import { repoPath } from '../cdl/store'
import { runProvider } from '../euc/tsr/confianca'
import { markProviderSubstituted } from '../tmd/confianca'
import { readProjectMemory } from '../csd/memoria'
import { readContract } from '../cdl/bss/armazenar'
import { DESIGN_SYSTEM_BRIEF } from '../agentes/tsl/design'
import { clarifyAnswersPrompt } from '../agentes/clr/clarificar'
import { refPaths, resolveRefs } from '../qlb/alf/refs'
import { markRefsRefused } from '../qlb/alf/confianca'
import { lerAcaoExterna } from '../osw/rta/externo'
import { execFileSync } from 'node:child_process'
import { renderizarSkills, skillsPara } from '../csd/acervo'
import { decidirEspecs } from '../osw/despacho-de-agentes'
import { checklistParaStack, renderizarChecklist } from '../agentes/vtb/checklist'
import type { ContextoDeGatilho, PapelDeSkill } from '../csd/acervo'

export interface StepResult {
  time: number
  cost: number
  costMeasured: boolean
  tokens: number
  text: string
  ok: boolean
  failureClass?: FailureClass
  failureReason?: string
  provider?: string
}

function firstLine(s: string, max: number): string {
  return String(s || '').split('\n')[0]?.slice(0, max) ?? ''
}

export const AGENTES_IMPLEMENT: readonly string[] = ['vitro', 'frontiteto', 'limpio', 'radix', 'rufus']

// Item 11: quem decide qual especialista atua e CODIGO, nunca o modelo. Antes
// daqui o prompt entregava o menu inteiro ("frontend -> vitro; banco -> radix;
// ...") e mandava a IA rotear — uma escolha que muda de opiniao entre execucoes
// e que ninguem auditou depois. Agora `decidirEspecs` decide a partir do diff,
// da dependencia declarada no contrato do alvo e do titulo da tarefa.
//
// Sem sinal nenhum, o resultado e vazio — e vazio significa NAO delegar, em vez
// de "a IA escolhe": nada e injetado e a implementacao segue direta. Menos
// delegacao sem motivo tambem e menos custo.
// Sem sinal nenhum (card novo, contrato sem framework, titulo generico) o
// padrao e DECLARADO aqui, nao escolhido pelo modelo. Nao injetar nada seria
// deterministico tambem, mas perderia capacidade em silencio; deixar a IA
// escolher e o que o item 11 proibe. Declarar o padrao mantem as duas coisas.
export const AGENTE_PADRAO = 'limpio'

function agentesEscolhidos(ctx: ContextoDeGatilho, titulo: string): string[] {
  const permitidos = new Set<string>(AGENTES_IMPLEMENT)
  const escolhidos = decidirEspecs({ arquivos: ctx.arquivos, deps: ctx.deps, titulo })
    .map(e => e.agente)
    .filter(a => permitidos.has(a))
  return escolhidos.length ? escolhidos : [AGENTE_PADRAO]
}

function roteamentoDeterministico(escolhidos: readonly string[]): string {
  return escolhidos.map(a => `${a} (escolhido pelo diff/contrato/titulo do card)`).join('; ')
}

function agentesInjetaveis(provider: Harness, nomes: readonly string[], ferramentasExtra: readonly string[]): Record<string, AgenteInjetado> {
  return provider.supportsAgents ? agentesNexusPor(nomes, ferramentasExtra) : {}
}

// Contexto do gatilho de skill: DETERMINISTICO, lido do disco. Arquivos que o
// card ja tocou no worktree, mais as dependencias declaradas pelo alvo. Nunca
// se pergunta a uma IA se a skill se aplica.
export function contextoDeSkill(workdir: string, repo: string): ContextoDeGatilho {
  const c = repo ? readContract(repo) : null
  // O contrato guarda framework e linguagem por pacote, nao a lista crua de
  // dependencias. Isso ja e o sinal que os gatilhos usam ("laravel", "vue"),
  // e vem de deteccao deterministica em disco.
  const deps = [...new Set((c?.packages ?? []).flatMap(p => [p.framework, p.language]).filter(Boolean))]
  let arquivos: string[] = []
  try {
    arquivos = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: workdir, encoding: 'utf8' })
      .split('\n').filter(Boolean)
  } catch {
    arquivos = []
  }
  return { arquivos, deps }
}

function stackOf(repo: string): string {
  const c = repo ? readContract(repo) : null
  return c?.stack ?? 'stack nao detectado — inspecione o projeto antes de editar'
}

function implementPrompt(agentesInjetados: readonly string[], workdir: string, desc: string, feedback: string, rules: string, visual: boolean, clarifications: string, refImages: string[], memory: string, stack: string, skills: string): string {
  const refs = refImages.length
    ? `REFERENCIAS DE DESIGN (${refImages.length}): abra CADA imagem abaixo com a tool Read e replique o design o mais FIEL possivel (layout, cores, tipografia, espacamento, componentes); extraia os tokens a partir delas. Imagens:\n${refImages.map(p => `- ${p}`).join('\n')}\n`
    : ''
  const head = agentesInjetados.length
    ? [
        'Use os AGENTES NEXUS deste projeto para implementar a tarefa abaixo (auto-construcao do hicode).',
        `O codigo a alterar fica em: ${workdir} — ${stack}. Edite os arquivos DESSE diretorio.`,
        `Use via Task exatamente estes: ${roteamentoDeterministico(agentesInjetados)}. A escolha ja foi feita pelo motor — nao substitua por outro agente. NAO rode crivo/review nesta etapa (nao chame o crivo): a revisao adversarial e os gates rodam DEPOIS, na fase de polimento do motor. Apenas implemente.`,
      ]
    : [
        'Implemente a tarefa abaixo (auto-construcao do hicode).',
        `O codigo a alterar fica em: ${workdir} — ${stack}. Edite os arquivos DESSE diretorio.`,
      ]
  return [
    rules ? `CONTEXTO DO PROJETO (.hii/rules.md — respeite):\n${rules}\n` : '',
    skills ? `${skills}\n` : '',
    memory ? `MEMORIA DO PROJETO (.hii/memory — decisoes/convencoes acumuladas, respeite):\n${memory}\n` : '',
    clarifications ? clarifications : '',
    refs,
    visual ? `${DESIGN_SYSTEM_BRIEF}\n` : '',
    ...head,
    'Faca a MENOR mudanca que cumpra a tarefa. NAO rode git, NAO faca commit, NAO inicie servidores. Sem comentarios de prosa.',
    feedback ? `\nATENCAO (reexecucao): ${feedback}` : '',
    '',
    'TAREFA:',
    desc ?? '',
    '',
    'Ao terminar, responda em 1 linha: qual agente atuou e o que mudou.',
  ].join('\n')
}

function acaoExternaPrompt(ferramenta: string, desc: string, feedback: string): string {
  return [
    `Esta tarefa e uma ACAO EXTERNA em ${ferramenta}, executada pelo conector MCP (tools mcp__*). NAO ha codigo a alterar: NAO edite nenhum arquivo deste repositorio e NAO chame agentes Nexus (Task).`,
    'Antes de escrever, localize o destino correto (pagina ou database pai) usando as tools MCP disponiveis. So entao execute a acao pedida.',
    feedback ? `ATENCAO (reexecucao): ${feedback}` : '',
    '',
    'TAREFA:',
    desc ?? '',
    '',
    'Ao terminar, responda em 1 linha o que foi criado e o link ou ID do resultado.',
  ].filter(Boolean).join('\n')
}

export async function implement(card: Card, workdir: string, feedback = '', visual = false): Promise<ImplementResult> {
  const desc = objetivoComInstrucoes(card.body, card.fm.title ?? '')
  const id = card.fm.id ?? ''
  const override = card.fm.provider_override_implement || undefined
  const provider = providerFor('implement', override)
  const model = modelFor('implement', override)
  if (override && !isProviderName(override)) markProviderSubstituted(id, override, provider.name)
  if (!provider.agentic) return { ok: false, reason: `provider ${provider.name} nao edita arquivos (nao-agentico) — use claude/codex para implementar`, cost: '', costMeasured: true, provider: provider.name, model, failureClass: 'terminal', failureReason: 'provider configurado nao edita arquivos' }
  const acaoExterna = lerAcaoExterna(card.fm.title ?? '', desc)
  let extraTools: string[] = []
  if (acaoExterna.externo) {
    const conector = await conectorExterno(acaoExterna.ferramenta)
    extraTools = conector.tools
    if (!conector.usavel) {
      return {
        ok: false,
        reason: `acao externa em ${acaoExterna.ferramenta} nao pode rodar: ${conector.motivo}`,
        cost: '',
        costMeasured: true,
        provider: provider.name,
        model,
        failureClass: 'terminal',
        failureReason: `conector ${acaoExterna.ferramenta} indisponivel`,
      }
    }
  }
  const refOutcomes = provider.supportsVision ? await resolveRefs(id) : []
  markRefsRefused(id, refOutcomes)
  const refImages = refPaths(refOutcomes)
  const dirs = refImages.length ? [workdir, join(cardsDir(), 'refs', id)] : [workdir]
  const target = repoPath(card.fm.repo ?? '')
  const memory = PROJECT_MEMORY ? readProjectMemory(target) : ''
  const navegacao = acaoExterna.externo ? [] : await navegacaoSemantica()
  extraTools = extraTools.concat(navegacao)
  const ctxSkill = contextoDeSkill(workdir, card.fm.repo ?? '')
  const escolhidos = agentesEscolhidos(ctxSkill, `${card.fm.title ?? ''} ${desc}`)
  const agentesInjetados = acaoExterna.externo || !escolhidos.length ? {} : agentesInjetaveis(provider, escolhidos, navegacao)
  const nomesInjetados = Object.keys(agentesInjetados)
  const prompt = acaoExterna.externo
    ? acaoExternaPrompt(acaoExterna.ferramenta, desc, feedback)
    : implementPrompt(nomesInjetados, workdir, desc, feedback, readProjectRules(workdir), visual, clarifyAnswersPrompt(id), refImages, memory, stackOf(target), renderizarSkills(skillsPara('implementador', ctxSkill)))
  const res = await runProvider(id, provider, {
    prompt,
    cwd: workdir,
    dirs,
    mode: 'edit',
    useAgents: nomesInjetados.length > 0,
    model,
    effort: effortFor('implement', card.fm.effort),
    modo: modoFor('implement', override),
    timeoutMs: RUN_TIMEOUT_MS,
    liveLog: id ? join(cardsDir(), 'runs', `${id}.live.log`) : undefined,
    extraTools,
    agentsJson: nomesInjetados.length ? JSON.stringify(agentesInjetados) : '',
  }, 'implement')
  const cost = res.cost ? res.cost.toFixed(4) : ''
  if (!res.ok) {
    const reason = res.isError
      ? `${provider.name} is_error: ${firstLine(res.text, 140)}`
      : `${provider.name} ${res.timedOut ? 'timeout' : 'falhou: ' + res.detail}`
    const cls = classifyFailure(provider, { timedOut: res.timedOut, detail: res.detail, text: res.text })
    return { ok: false, reason, cost, costMeasured: res.costMeasured, usage: res.usage, timedOut: res.timedOut, failureClass: cls.failureClass, failureReason: cls.reason, provider: provider.name, model }
  }
  return { ok: true, resultText: firstLine(res.text, 140), fullText: String(res.text || '').slice(0, 8000), cost, costMeasured: res.costMeasured, usage: res.usage, provider: provider.name, model }
}

export async function verifyVisual(card: Card, shotPath: string): Promise<VerifyResult> {
  if (!existsSync(shotPath)) return { ok: false, conclusive: false, reason: 'sem screenshot — url nao renderizou (inconclusivo)', cost: 0, tokens: 0 }
  const provider = providerFor('verify')
  if (!provider.supportsVision) return { ok: false, conclusive: false, reason: `provider ${provider.name} nao le imagem — verify visual inconclusivo`, cost: 0, tokens: 0 }
  const desc = extractObjetivo(card.body) || card.fm.title
  const prompt = [
    'Voce e um verificador VISUAL. Use a tool Read para abrir a imagem (screenshot da pagina web renderizada) no caminho abaixo e analise o que aparece.',
    `Imagem: ${shotPath}`,
    `Tarefa que deveria ter sido aplicada: "${desc}"`,
    'A mudanca/elemento pedido aparece DE FATO e visivelmente na pagina? Seja rigoroso. Responda APENAS um JSON em uma linha, sem texto extra: {"ok": true ou false, "reason": "motivo curto"}.',
  ].join('\n')
  const res = await runProvider(card.fm.id ?? '', provider, {
    prompt,
    cwd: ROOT,
    dirs: [dirname(shotPath)],
    mode: 'readonly',
    useAgents: false,
    model: modelFor('verify'),
    effort: effortFor('verify', card.fm.effort),
    timeoutMs: 120000,
  }, 'verify')
  const tokens = sumTokens(res.usage)
  const inner = res.text.match(/\{[\s\S]*?\}/)
  if (inner && inner[0]) {
    try {
      const v = JSON.parse(inner[0]) as { ok?: boolean; reason?: string }
      return { ok: !!v.ok, conclusive: true, reason: String(v.reason || '').slice(0, 140), cost: res.cost, tokens }
    } catch { void 0 }
  }
  return { ok: false, conclusive: false, reason: 'verify inconclusivo (sem veredito parseavel)', cost: res.cost, tokens }
}

// Mapa agente -> papel de skill. Deterministico e explicito: um agente novo
// sem entrada aqui simplesmente nao recebe skill, em vez de receber a errada.
const PAPEL_DO_AGENTE: Record<string, PapelDeSkill> = {
  rufus: 'reparador',
  testudo: 'avaliador',
  escudo: 'seguranca',
  crivo: 'avaliador',
  pura: 'reparador',
  glossia: 'documentador',
}

function skillsDoAgente(agent: string, wt: string, repo: string): string {
  const papel = PAPEL_DO_AGENTE[agent]
  if (!papel) return ''
  const skills = renderizarSkills(skillsPara(papel, contextoDeSkill(wt, repo)))
  // VTB: o checklist da stack roda DEPOIS do security-baseline generico, e so
  // para o papel de seguranca. Um checklist de Laravel num passo de limpeza
  // seria ruido caro.
  const checklist = papel === 'seguranca' ? renderizarChecklist(checklistParaStack(stackOf(repo))) : ''
  return [skills, checklist].filter(Boolean).join('\n\n')
}

function stepPrompt(agenteInjetado: boolean, wt: string, agent: string, instruction: string, rules: string, stack: string, skills: string): string {
  const head = agenteInjetado
    ? `Use o agente Nexus ${agent} no projeto em ${wt} — ${stack}. Edite arquivos apenas se necessario.`
    : `Atue no papel "${agent}" no projeto em ${wt} — ${stack}. Edite arquivos apenas se necessario.`
  return [
    rules ? `CONTEXTO DO PROJETO (.hii/rules.md — respeite):\n${rules}\n` : '',
    skills ? `${skills}\n` : '',
    head,
    'NAO rode git/commit, NAO inicie servidores. Sem comentarios de prosa no codigo. Se nao houver nada a fazer, responda "nada a fazer".',
    instruction,
    'Responda em 1 linha o que foi feito.',
  ].join('\n')
}

export async function runStep(wt: string, agent: string, instruction: string, id = '', repo = ''): Promise<StepResult> {
  const t = Date.now()
  const provider = providerFor('step')
  if (!provider.agentic) return { time: 0, cost: 0, costMeasured: true, tokens: 0, ok: false, text: `provider ${provider.name} nao-agentico — step "${agent}" NAO executou (use claude/codex para steps que editam)`, failureClass: 'terminal', failureReason: 'provider configurado nao edita arquivos', provider: provider.name }
  const navegacao = await navegacaoSemantica()
  const agenteInjetado = agentesInjetaveis(provider, [agent], navegacao)
  const injetou = Object.keys(agenteInjetado).length > 0
  const res = await runProvider(id, provider, {
    prompt: stepPrompt(injetou, wt, agent, instruction, readProjectRules(wt), stackOf(repo || wt), skillsDoAgente(agent, wt, repo)),
    cwd: wt,
    dirs: [wt],
    mode: 'edit',
    useAgents: injetou,
    model: modelFor('step'),
    effort: effortFor('step'),
    modo: modoFor('step'),
    timeoutMs: RUN_TIMEOUT_MS,
    liveLog: id ? join(cardsDir(), 'runs', `${id}.live.log`) : undefined,
    extraTools: navegacao,
    agentsJson: injetou ? JSON.stringify(agenteInjetado) : '',
  }, 'step')
  const time = Math.round((Date.now() - t) / 1000)
  const tokens = sumTokens(res.usage)
  if (!res.ok) {
    const cls = classifyFailure(provider, { timedOut: res.timedOut, detail: res.detail, text: res.text })
    return { time, cost: res.cost, costMeasured: res.costMeasured, tokens, text: firstLine(res.text, 120) || res.detail, ok: false, failureClass: cls.failureClass, failureReason: cls.reason, provider: provider.name }
  }
  return { time, cost: res.cost, costMeasured: res.costMeasured, tokens, text: firstLine(res.text, 120), ok: true, provider: provider.name }
}
