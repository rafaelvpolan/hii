import { dirname, join } from 'node:path'
import { objetivoComInstrucoes } from '../mirante/instruir.ts'
import { existsSync } from 'node:fs'
import { lerEscopo, SEM_ESCOPO } from '../oswaldo/rota/escopo.ts'
import type { EscopoDeEscrita } from '../oswaldo/rota/escopo.ts'
import { extractObjetivo } from '../cordel/index.ts'
import type { Card, ClasseDeEspera, FailureClass, ImplementResult, VerifyResult } from '../cordel/index.ts'
import { cardsDir, ROOT, RUN_TIMEOUT_MS, PROJECT_MEMORY } from '../cordel/alicerce/config.ts'
import { isProviderName, modelFor, providerFor, effortFor, modoFor } from '../tomada/registro.ts'
import { sumTokens } from '../tomada/uso.ts'
import { classifyFailure } from './reprise/classe-de-falha.ts'
import type { Harness } from '../tomada/tipos.ts'
import { conectorExterno, navegacaoSemantica } from '../tomada/ponte/mcp.ts'
import { agentesNexusPor } from '../agentes/registro.ts'
import type { AgenteInjetado } from '../agentes/registro.ts'
import { readProjectRules } from '../cordel/alicerce/home.ts'
import { repoPath } from '../cordel/store.ts'
import { runProvider } from '../euclides/tesouro/confianca.ts'
import { markProviderSubstituted } from '../tomada/confianca.ts'
import { readProjectMemory } from '../cascudo/memoria.ts'
import { readContract } from '../cordel/bussola/armazenar.ts'
import { DESIGN_SYSTEM_BRIEF } from '../agentes/tarsila/design.ts'
import { clarifyAnswersPrompt } from '../agentes/clarice/clarificar.ts'
import { refPaths, resolveRefs } from '../quilombo/alfandega/refs.ts'
import { markRefsRefused } from '../quilombo/alfandega/confianca.ts'
import { lerAcaoExterna } from '../oswaldo/rota/externo.ts'
import { execFileSync } from 'node:child_process'
import { renderizarSkills, skillsPara } from '../cascudo/acervo.ts'
import { packsDoCard } from '../mirante/comandos-manuais.ts'
import { decidirEspecs } from '../oswaldo/despacho-de-agentes.ts'
import { checklistParaStack, renderizarChecklist } from '../agentes/vital/checklist.ts'
import type { ContextoDeGatilho, PapelDeSkill } from '../cascudo/acervo.ts'

export interface StepResult {
  time: number
  cost: number
  costMeasured: boolean
  tokens: number
  text: string
  ok: boolean
  failureClass?: FailureClass
  failureReason?: string
  waitClass?: ClasseDeEspera
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
export function contextoDeSkill(workdir: string, repo: string, packs: readonly string[] = []): ContextoDeGatilho {
  const c = repo ? readContract(repo) : null
  // O contrato guarda framework e linguagem por pacote, nao a lista crua de
  // dependencias. Isso ja e o sinal que os gatilhos usam ("laravel", "vue"),
  // e vem de deteccao deterministica em disco.
  const deps = [...new Set((c?.packages ?? []).flatMap(p => [p.framework, p.language]).filter(Boolean))]
  let arquivos: string[] = []
  try {
    arquivos = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: workdir, encoding: 'utf8' })
      .split('\n').filter(Boolean)
  } catch (e) {
    // "git diff falhou" e "nenhum arquivo alterado" tinham a MESMA
    // representacao ([]), sem uma linha em lugar nenhum. Consequencia
    // silenciosa: todo gatilho de skill por `files:` deixa de disparar e o
    // roteamento cai no AGENTE_PADRAO como se nao houvesse sinal — perda de
    // capacidade que ninguem veria.
    process.stderr.write(`[hicode] git diff --name-only HEAD falhou em ${workdir} (${String((e as Error).message).slice(0, 120)}) — os gatilhos de skill por arquivo NAO vao disparar neste passo\n`)
    arquivos = []
  }
  return { arquivos, deps, packs }
}

function stackOf(repo: string): string {
  const c = repo ? readContract(repo) : null
  return c?.stack ?? 'stack nao detectado — inspecione o projeto antes de editar'
}

// O bloco de escopo vai no TOPO do prompt, antes de qualquer contexto: e a unica
// instrucao cuja violacao o motor barra depois. Dizer no prompt nao basta — quem
// garante e a checagem do diff em motor/oswaldo/executar.ts —, mas o agente merece
// saber a regra antes de trabalhar em vez de descobrir no HALT.
function blocoDeEscopo(e: EscopoDeEscrita): string {
  if (!e.alvos.length && !e.referencias.length) return ''
  // Cada linha diz a verdade sobre o que o motor faz com ela. A regra de LEITURA e
  // conferida no diff em dois pontos (oswaldo/executar.ts depois do implement,
  // quilombo/cartorio/fechar.ts contra origin/<base>) e para a tarefa. O "escreva somente em"
  // NAO e barrado: `foraDoEscopo` so barra escrita DENTRO de referencia declarada,
  // porque tratar todo caminho nao citado como proibido trocaria "editou onde nao
  // devia" por "nao consegue editar o import que precisava" — o primeiro aparece no
  // diff, o segundo parece motor quebrado. Anunciar cumprimento que nao existe seria
  // pior que nao anunciar: o modelo calibra pelo que a mensagem afirma.
  const linhas = ['ESCOPO DE ESCRITA (lido do pedido do humano):']
  if (e.alvos.length) linhas.push(`- O alvo do pedido e: ${e.alvos.join(', ')} — comece por ai e nao espalhe a mudanca sem necessidade.`)
  if (e.referencias.length) {
    linhas.push(`- SO LEITURA (nao edite, nao crie, nao apague nada aqui): ${e.referencias.join(', ')}`)
    linhas.push('  Estes caminhos sao REFERENCIA: leia deles o que precisar (cores, tokens, convencoes) e aplique no alvo.')
    linhas.push('  O motor CONFERE isto no diff e PARA a tarefa se for violado.')
  }
  return `${linhas.join('\n')}\n`
}

function implementPrompt(agentesInjetados: readonly string[], workdir: string, desc: string, feedback: string, rules: string, visual: boolean, clarifications: string, refImages: string[], memory: string, stack: string, skills: string, escopo: EscopoDeEscrita): string {
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
    blocoDeEscopo(escopo),
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

// O escopo e lido do PEDIDO, com checagem de existencia contra o worktree — prosa
// com barra ("feito/executado em ...") nao vira caminho.
export function escopoDoCard(card: Card, workdir: string): EscopoDeEscrita {
  const texto = `${card.fm.title ?? ''} ${objetivoComInstrucoes(card.body, card.fm.title ?? '')}`
  return lerEscopo(texto, caminho => existsSync(join(workdir, caminho)))
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
        // Nao consegui LISTAR e diferente de nao existe: o primeiro passa, e um
        // HALT sem retry por causa dele parava o card por um hiccup do binario.
        failureClass: conector.transitorio ? 'transient' : 'terminal',
        failureReason: conector.transitorio
          ? `nao consegui verificar o conector ${acaoExterna.ferramenta} (listagem MCP falhou)`
          : `conector ${acaoExterna.ferramenta} indisponivel`,
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
  // `target` (caminho no disco), nao `card.fm.repo` (nome "owner/repo"): readContract
  // faz join(repo, '.hii', 'contract.json'), entao o nome virava caminho relativo
  // inexistente e `deps` saia sempre vazio — os 12 SKILL.md com gatilho `deps:` nunca
  // disparavam, e o roteamento por dependencia do item 11 era letra morta.
  const ctxSkill = contextoDeSkill(workdir, target, packsDoCard(card.fm.packs))
  const escolhidos = agentesEscolhidos(ctxSkill, `${card.fm.title ?? ''} ${desc}`)
  // `!escolhidos.length` era condicao morta: agentesEscolhidos nunca devolve lista
  // vazia desde que AGENTE_PADRAO entrou. Guarda que nao pode ser verdadeira
  // esconde a regra de verdade, que e "acao externa nao injeta agente".
  const agentesInjetados = acaoExterna.externo ? {} : agentesInjetaveis(provider, escolhidos, navegacao)
  const nomesInjetados = Object.keys(agentesInjetados)
  const prompt = acaoExterna.externo
    ? acaoExternaPrompt(acaoExterna.ferramenta, desc, feedback)
    : implementPrompt(nomesInjetados, workdir, desc, feedback, readProjectRules(workdir), visual, clarifyAnswersPrompt(id), refImages, memory, stackOf(target), renderizarSkills(skillsPara('implementador', ctxSkill)), escopoDoCard(card, workdir))
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
    return { ok: false, reason, cost, costMeasured: res.costMeasured, usage: res.usage, timedOut: res.timedOut, failureClass: cls.failureClass, failureReason: cls.reason, waitClass: cls.classeDeEspera, provider: provider.name, model }
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

// `alvo` e o CAMINHO do clone principal, onde ensureContract grava
// .hii/contract.json (motor/quilombo/cartorio/fechar.ts:85). Nao adianta cair para o worktree:
// .hii/ nao e rastreado em git, entao um worktree recem-criado nao tem contrato.
export function skillsDoAgente(agent: string, wt: string, alvo: string, packs: readonly string[] = []): string {
  const papel = PAPEL_DO_AGENTE[agent]
  if (!papel) return ''
  const skills = renderizarSkills(skillsPara(papel, contextoDeSkill(wt, alvo, packs)))
  // Vital: o checklist da stack roda DEPOIS do security-baseline generico, e so
  // para o papel de seguranca. Um checklist de Laravel num passo de limpeza
  // seria ruido caro.
  const checklist = papel === 'seguranca' ? renderizarChecklist(checklistParaStack(stackOf(alvo))) : ''
  return [skills, checklist].filter(Boolean).join('\n\n')
}

function stepPrompt(agenteInjetado: boolean, wt: string, agent: string, instruction: string, rules: string, stack: string, skills: string, escopo: EscopoDeEscrita): string {
  const head = agenteInjetado
    ? `Use o agente Nexus ${agent} no projeto em ${wt} — ${stack}. Edite arquivos apenas se necessario.`
    : `Atue no papel "${agent}" no projeto em ${wt} — ${stack}. Edite arquivos apenas se necessario.`
  return [
    blocoDeEscopo(escopo),
    rules ? `CONTEXTO DO PROJETO (.hii/rules.md — respeite):\n${rules}\n` : '',
    skills ? `${skills}\n` : '',
    head,
    'NAO rode git/commit, NAO inicie servidores. Sem comentarios de prosa no codigo. Se nao houver nada a fazer, responda "nada a fazer".',
    instruction,
    'Responda em 1 linha o que foi feito.',
  ].join('\n')
}

// `id` e `repo` sao OBRIGATORIOS de proposito. Enquanto tinham default, os tres
// chamadores de producao passavam 4 argumentos e `repo` era sempre '' — o checklist
// de seguranca por stack (item 7) nunca era injetado e ninguem percebia, porque o
// teste que o guardava era um grep no texto-fonte. Sem default, o compilador reprova
// o proximo call site que esquecer.
// `packs` fecha o ultimo elo do item 16: o pack que o humano escolheu no atalho de
// intake valia SO para o implementador. Todos os passos de polimento e de gate
// (rufus, escudo, testudo, pura, glossia) recebiam lista vazia, entao o
// conhecimento pre-carregado pelo `/orquestrador-*` nao alcancava justamente quem
// revisa. Sem default: o compilador reprova o proximo call site que esquecer.
// `escopo` tambem nos passos de polimento: o rufus e o pura editam arquivo, e um
// escopo que valesse so para o implementador seria escopo pela metade.
export async function runStep(wt: string, agent: string, instruction: string, id: string, repo: string, packs: readonly string[] = [], escopo: EscopoDeEscrita = SEM_ESCOPO): Promise<StepResult> {
  const t = Date.now()
  const provider = providerFor('step')
  if (!provider.agentic) return { time: 0, cost: 0, costMeasured: true, tokens: 0, ok: false, text: `provider ${provider.name} nao-agentico — step "${agent}" NAO executou (use claude/codex para steps que editam)`, failureClass: 'terminal', failureReason: 'provider configurado nao edita arquivos', provider: provider.name }
  const navegacao = await navegacaoSemantica()
  const agenteInjetado = agentesInjetaveis(provider, [agent], navegacao)
  const injetou = Object.keys(agenteInjetado).length > 0
  const res = await runProvider(id, provider, {
    prompt: stepPrompt(injetou, wt, agent, instruction, readProjectRules(wt), stackOf(repo), skillsDoAgente(agent, wt, repo, packs), escopo),
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
    return { time, cost: res.cost, costMeasured: res.costMeasured, tokens, text: firstLine(res.text, 120) || res.detail, ok: false, failureClass: cls.failureClass, failureReason: cls.reason, waitClass: cls.classeDeEspera, provider: provider.name }
  }
  return { time, cost: res.cost, costMeasured: res.costMeasured, tokens, text: firstLine(res.text, 120), ok: true, provider: provider.name }
}
