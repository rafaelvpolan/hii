import type { PipelineStep } from '../../niemeyer/tipos.ts'
import { lerAcaoExterna } from './externo.ts'
import type { VeredictoDaLei } from '../../cascudo/lei/guarda.ts'

export type StepProfile = 'completo' | 'padrao' | 'deps' | 'enxuto' | 'visual' | 'externo' | 'repo'

export interface TaskInput {
  title?: string
  objetivo?: string
  risk?: string
  surface?: string
  override?: string
  divergir?: string
}

export interface StepPlan {
  profile: StepProfile
  reason: string
  steps: PipelineStep[]
  skipped: string[]
}

const SECURITY = ['auth\\w*', 'autentic\\w*', 'login', 'logout', 'senha\\w*', 'password\\w*', 'token\\w*', 'secret\\w*', 'segredo\\w*', 'jwt', 'oauth', 'sso', 'permiss\\w*', 'autoriz\\w*', 'rbac', 'acl', 'cors', 'csrf', 'xss', 'inje\\w*', 'cripto\\w*', 'hash\\w*', 'cookie\\w*', 'sess\\w*', 'credencial\\w*', 'vulnerab\\w*', 'cve', 'sanitiz\\w*', 'upload\\w*', 'webhook\\w*', 'pagamento\\w*', 'payment\\w*', 'checkout', 'cartao\\w*', 'pix', 'boleto\\w*', 'cobranca\\w*', 'fatura\\w*', 'billing', 'stripe', 'paypal']
const BACKEND = ['endpoint\\w*', 'api', 'rota\\w*', 'route\\w*', 'servidor\\w*', 'server', 'backend', 'handler\\w*', 'middleware\\w*', 'servic\\w*', 'service\\w*', 'controller\\w*']
const DATA = ['migration\\w*', 'migracao', 'migracoes', 'schema\\w*', 'query\\w*', 'sql', 'banco', 'database', 'indice\\w*', 'tabela\\w*', 'coluna\\w*', 'orm', 'prisma', 'supabase']
const DEPS = ['dependenc\\w*', 'pacote\\w*', 'package\\w*', 'lockfile', 'bump', 'upgrade\\w*', 'downgrade\\w*', 'versionamento', 'semver']
const LOGIC = ['fix', 'bug', 'refator\\w*', 'refatora\\w*', 'refactor\\w*', 'feature', 'funcionalidade\\w*', 'funcao\\w*', 'function\\w*', 'logic\\w*', 'calcul\\w*', 'algoritmo\\w*', 'estado', 'store', 'hook\\w*', 'valida\\w*', 'integr\\w*', 'fluxo\\w*', 'regra\\w*', 'comportamento\\w*', 'component\\w*', 'componente\\w*']
const COSMETIC = ['texto\\w*', 'text', 'copy', 'copie', 'redac\\w*', 'palavra\\w*', 'frase\\w*', 'typo', 'ortograf\\w*', 'gramatic\\w*', 'label\\w*', 'rotulo\\w*', 'wording', 'mensagem\\w*', 'conteudo\\w*', 'readme', 'documentac\\w*', 'docs', 'comentario\\w*', 'tradu\\w*', 'idioma', 'renomear']

// ESTILO — o vocabulario que faltava por inteiro. Nao havia UMA palavra de cor,
// css ou layout em nenhuma lista: uma tarefa de "deixar as cores iguais" nunca
// podia ser vista como leve, e caia em `padrao` (Arquitetura + Testes + Limpeza)
// por qualquer palavra solta de logica no enunciado.
//
// Estilo NAO e o mesmo que `surface: visual`: aquele campo diz que a tarefa tem
// tela para olhar; este diz que o TRABALHO e de aparencia. Um card pode ter tela e
// mexer em logica.
const ESTILO_FORTE = [
  'cor', 'cores', 'colorac\\w*', 'paleta\\w*', 'tonalidade\\w*', 'matiz\\w*',
  'css', 'scss', 'sass', 'less', 'estilo\\w*', 'estiliz\\w*', 'style\\w*', 'styling',
  'theme\\w*', 'dark mode', 'darkmode', 'light mode', 'lightmode',
  'layout\\w*', 'espacamento\\w*', 'padding', 'margin',

  // `fonte` e tipografia em quase todo card, MENOS nas colocacoes em que ela e
  // origem de dado: "fonte de dados", "fonte de verdade", "fonte de informacao".
  // Rebaixar a palavra inteira custava "mudar a fonte do titulo" rodando o pipeline
  // completo; o lookahead nega so o que de fato colide.
  'tipografi\\w*', 'fontes?(?!\\s+(?:unica\\s+)?d[ea]\\s+(?:dados|verdade|informac|renda|receita))', 'font-\\w+', 'fontsize', 'fontweight',
  'borda\\w*', 'border\\w*', 'radius', 'sombra\\w*', 'shadow',
  'icone\\w*', 'icon\\w*', 'badge\\w*', 'pill',
  // `token` NAO entra aqui: ele e de SECURITY (token de auth), e sinal duro vence
  // estilo. "design token" perde para "token de sessao" de proposito — rodar
  // seguranca a mais numa troca de paleta custa uma chamada; nao rodar numa troca
  // de token de auth custa o incidente. Quem quiser o caminho rapido escreve
  // "paleta", "cores" ou "css", que estao nesta lista.
  'tailwind', 'bootstrap',
  'responsiv\\w*', 'breakpoint\\w*',
  'visual\\w*', 'aparencia\\w*',
]

// As palavras que NAO estao em ESTILO_FORTE, e por que:
//
//   tom, tons, tamanho, peso, classe, variavel, espaco, margem, raio, alinha,
//   aspecto, chip, mobile, desktop, gap, centralizar, tema, light, contraste,
//   alinhamento
//
// Todas sao ambiguas em portugues de projeto: "margem de lucro", "classe de
// comissao", "peso da nota", "gap de calculo", "centralizar o calculo", "plano
// light", "tema da aula", "contraste entre os numeros".
//
// Elas tiveram uma regra propria — valiam em PAR ("tamanho da fonte") — e a regra
// rendeu dois defeitos: contava "tamanho" e "tamanhos" como duas evidencias, e o
// veto por LOGIC dependia de a palavra de logica estar numa lista que nunca fica
// completa ("impedir peso e tamanho acima do limite no envio do lote" nao tinha
// nenhuma, e ganhava zero passo). O par tambem deixou de comprar qualquer coisa
// quando `fonte` voltou a FORTE: era o unico caso que so ele resolvia.
//
// Entao a regra caiu. Palavra ambigua nao decide nada, nunca — mesmo criterio do
// `token` acima: rodar o pipeline a mais numa troca de cor custa quatro chamadas de
// agente; pular Testes numa mudanca de regra de negocio custa o incidente.

// Macunaima — vocabulario de pergunta ABERTA: onde existe mais de uma forma certa e a
// escolha e de desenho. So aqui divergir se paga.
const REPO = ['conflito\\w*', 'conflict\\w*', 'merge', 'mergear', 'rebase', 'cherry-pick', 'cherrypick', 'gitignore', 'changelog', 'revert\\w*', 'reverter', 'submodul\\w*', 'pull request', 'worktree\\w*']

const ABERTO = ['arquitet\\w*', 'desenh\\w*', 'design', 'estrateg\\w*', 'abordagem\\w*', 'alternativ\\w*', 'reestrutur\\w*', 'repens\\w*', 'escalab\\w*', 'modelag\\w*', 'nomenclatura\\w*', 'naming', 'nomear', 'contrato\\w*', 'protocolo\\w*', 'tradeoff\\w*', 'padr\\w*']
// Vocabulario de RESPOSTA UNICA: calculo de comissao nao tem "varias formas
// certas". Abrir N ramos sobre aritmetica gasta N vezes para reencontrar a
// mesma resposta.
const FECHADO = ['calcul\\w*', 'formula\\w*', 'aritmetic\\w*', 'convers\\w*', 'arredond\\w*', 'comiss\\w*', 'imposto\\w*', 'aliquota\\w*', 'juros', 'typo', 'ortograf\\w*', 'bump', 'lockfile', 'reparo\\w*', 'build']
function buildRe(stems: string[]): RegExp {
  return new RegExp('\\b(?:' + stems.join('|') + ')\\b')
}

const SEC_RE = buildRe(SECURITY)
const BACKEND_RE = buildRe(BACKEND)
const DATA_RE = buildRe(DATA)
const DEPS_RE = buildRe(DEPS)
const LOGIC_RE = buildRe(LOGIC)
const COSMETIC_RE = buildRe(COSMETIC)
const ESTILO_FORTE_RE = buildRe(ESTILO_FORTE)
const REPO_RE = buildRe(REPO)
const ABERTO_RE = buildRe(ABERTO)
const FECHADO_RE = buildRe(FECHADO)

function norm(s: string | undefined): string {
  return (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

interface Signals {
  riskHigh: boolean
  externo: boolean
  motivoExterno: string
  sec: boolean
  backend: boolean
  data: boolean
  deps: boolean
  logic: boolean
  cosmetic: boolean
  visual: boolean
  estilo: boolean
  repo: boolean
  codey: boolean
  cosmeticOnly: boolean
  visualOnly: boolean
  estiloOnly: boolean
  repoOnly: boolean
  lean: boolean
  ambiguous: boolean
}

function signalsOf(task: TaskInput): Signals {
  const t = ` ${norm(task.title)} ${norm(task.objetivo)} `
  const sec = SEC_RE.test(t)
  const backend = BACKEND_RE.test(t)
  const data = DATA_RE.test(t)
  const deps = DEPS_RE.test(t)
  const logic = LOGIC_RE.test(t)
  const cosmetic = COSMETIC_RE.test(t)
  const visual = task.surface === 'visual'
  const estilo = ESTILO_FORTE_RE.test(t)
  const repo = REPO_RE.test(t)
  const codey = logic || backend || data || deps
  const cosmeticOnly = cosmetic && !codey && !sec
  const visualOnly = visual && !backend && !data && !deps && !sec && !logic
  // ESTILO vence LOGIC, e NAO vence sec/backend/data/deps.
  //
  // O motivo e o caso medido: "analise de cores ... ao INTEGRAR o ranking deve
  // combinar as cores" caia em `padrao` porque `integr\w*` casa "integrar". A
  // palavra de logica ali e contexto do pedido, nao o pedido. Sinal DURO
  // (seguranca, backend, dados, dependencia) continua mandando, porque ali o custo
  // de errar para baixo e alto — e a LEI, que olha o diff, ainda pode SUBIR o
  // rigor depois, independentemente do que o enunciado disse.
  const estiloOnly = estilo && !sec && !backend && !data && !deps 
  const repoOnly = repo && !sec && !backend && !data && !deps
  const externa = lerAcaoExterna(task.title ?? '', task.objetivo ?? '')
  return {
    riskHigh: task.risk === 'high',
    externo: externa.externo,
    motivoExterno: externa.motivo,
    sec, backend, data, deps, logic, cosmetic, visual, estilo, repo, codey,
    cosmeticOnly, visualOnly, estiloOnly, repoOnly,
    lean: cosmeticOnly || visualOnly || estiloOnly,
    ambiguous: !cosmetic && !visual && !estilo && !repo && !codey && !sec,
  }
}

function keepStep(step: PipelineStep, s: Signals): boolean {
  if (s.riskHigh) return true
  if (s.externo) return false
  // Perfil `visual`: NENHUM passo de pipeline. O que revisa e o crivo do fecho, que
  // le o diff — uma chamada de agente, nao quatro. Mudanca de aparencia nao ganha
  // nada de um passo de arquitetura, e o pedagio afastava o uso do motor para o que
  // ele deveria ser mais rapido.
  if (s.estiloOnly) return false
  if (s.repoOnly) return step.id === 'testes'
  if (step.kind === 'security') return s.sec || s.backend || s.data || s.deps || s.ambiguous
  // `kind: 'review'` continua valido em pipeline CUSTOMIZADO (.hii/pipeline.json do
  // alvo), por isso a regra fica. O pipeline deste repo nao tem mais step assim: o
  // veredito dele nunca era lido, e runCodefoxGate no fecho ja revisa lendo o diff.
  if (step.kind === 'review') return !s.lean
  if (step.kind === 'cleanup') return !s.cosmeticOnly
  if (step.kind === 'quality') {
    if (step.id === 'testes') return s.logic || s.backend || s.data || s.deps || s.sec || s.ambiguous
    return s.logic || s.backend || s.data || s.sec || s.ambiguous
  }
  return true
}

function profileOf(s: Signals): StepProfile {
  if (s.riskHigh) return 'completo'
  if (s.externo) return 'externo'
  if (s.estiloOnly) return 'visual'
  if (s.repoOnly) return 'repo'
  if (s.lean) return 'enxuto'
  if (s.deps && !s.logic && !s.backend && !s.data) return 'deps'
  return 'padrao'
}

function reasonOf(s: Signals): string {
  if (s.riskHigh) return 'risco alto — roda tudo'
  if (s.externo) return s.motivoExterno
  if (s.sec) return 'sinal de seguranca — inclui escudo'
  if (s.estiloOnly) return 'mudanca de aparencia (cor/css/layout) — vai direto ao crivo do fecho, que le o diff'
  if (s.repoOnly) return 'trabalho de repositorio (conflito/merge/rebase) — so Testes: o que corre risco e a suite depois da costura, nao a arquitetura'
  if (s.cosmeticOnly) return 'mudanca cosmetica/texto — pula qualidade e seguranca'
  if (s.visualOnly) return 'mudanca so visual — pula seguranca/arquitetura/testes'
  if (s.deps && !s.logic && !s.backend && !s.data) return 'dependencias — testes + seguranca(CVE), pula arquitetura'
  if (s.backend || s.data) return 'backend/dados — inclui seguranca e testes'
  if (s.ambiguous) return 'ambiguo — roda tudo por seguranca'
  return 'logica — qualidade + review, seguranca so por sinal'
}

function parseOverride(steps: PipelineStep[], ov: string): StepPlan | null {
  if (ov === 'all') return { profile: 'completo', reason: 'forcado no card (steps: all)', steps, skipped: [] }
  const ids = new Set(ov.split(',').map(x => x.trim()).filter(Boolean))
  if (!ids.size) return null
  const steplist = steps.filter(s => ids.has(s.id))
  return {
    profile: 'padrao',
    reason: `forcado no card (steps: ${ov})`,
    steps: steplist,
    skipped: steps.filter(s => !ids.has(s.id)).map(s => s.label),
  }
}

export function planSteps(task: TaskInput, steps: PipelineStep[]): StepPlan {
  const ov = (task.override ?? '').trim()
  if (ov && ov !== 'auto') {
    const forced = parseOverride(steps, ov)
    if (forced) return forced
  }
  const s = signalsOf(task)
  const kept = steps.filter(step => keepStep(step, s))
  const keptIds = new Set(kept.map(k => k.id))
  return {
    profile: profileOf(s),
    reason: reasonOf(s),
    steps: kept,
    skipped: steps.filter(step => !keptIds.has(step.id)).map(step => step.label),
  }
}

// A unica porta por onde a LEI mexe no plano. Funcao propria, e nao inline no
// chamador, para que a invariante "so sobe, nunca baixa" tenha um lugar unico
// onde ser testada.
export function aplicarLei(plano: StepPlan, lei: VeredictoDaLei, todos: PipelineStep[]): StepPlan {
  if (lei.forca !== 'completo') return plano
  // Uniao com o plano anterior, sempre: nenhum passo que ja ia rodar pode
  // deixar de rodar por causa da LEI. Como 'completo' e o conjunto inteiro,
  // isto e `todos` — mas escrito como uniao para o dia em que 'completo'
  // deixar de ser o superconjunto.
  // Uniao de verdade, nao um filtro de predicado constante: `todos` mais o que ja
  // ia rodar e nao esta em `todos`. Hoje da o mesmo resultado porque 'completo' e o
  // superconjunto; no dia em que deixar de ser, nenhum passo aprovado cai.
  const idsDeTodos = new Set(todos.map(p => p.id))
  const steps = [...todos, ...plano.steps.filter(p => !idsDeTodos.has(p.id))]
  return {
    profile: 'completo',
    reason: `${plano.reason} · LEI elevou para completo (${lei.motivos.length} motivo(s))`,
    steps,
    skipped: [],
  }
}

// Macunaima — o gatilho da divergencia. Deliberado: mesmo formato de veredicto do Canudos
// (`{ vale, motivo }`), porque os dois respondem a mesma pergunta — "este card
// merece um modo que custa varias vezes mais?".
//
// O PADRAO E NAO DIVERGIR, e isso nao e timidez. N ramos multiplicam o custo por
// N; um gatilho que erra para o lado de ligar transforma cada card ambiguo numa
// conta multiplicada, e o operador so descobre no fim do mes. Quando nada no
// enunciado indica pergunta de desenho, a resposta certa e nao gastar.
//
// Note a ordem: FECHADO vence ABERTO. "arquitetura do calculo de comissao" tem
// as duas marcas, e a resposta continua sendo uma so.
export interface VeredictoDeDivergencia {
  readonly vale: boolean
  readonly motivo: string
}

export function valeDivergir(task: TaskInput): VeredictoDeDivergencia {
  const ov = (task.divergir ?? '').trim()
  if (ov === 'on') return { vale: true, motivo: 'ligado no card (divergir: on)' }
  if (ov === 'off') return { vale: false, motivo: 'desligado no card (divergir: off)' }

  const s = signalsOf(task)
  if (s.externo) return { vale: false, motivo: `${s.motivoExterno} — acao externa nao tem alternativa de desenho para comparar` }
  const t = ` ${norm(task.title)} ${norm(task.objetivo)} `
  if (FECHADO_RE.test(t)) return { vale: false, motivo: 'enunciado com resposta unica — divergir gastaria N vezes para reencontrar a mesma resposta' }
  // ABERTO vem ANTES de `lean`, para os TRES tipos de leve. "repensar a arquitetura
  // do tema de cores" e pergunta de desenho que por acaso e sobre cor; e o mesmo
  // enunciado nao pode mudar de resposta so porque o card tem `surface: visual`,
  // que diz que existe TELA, nao que a pergunta deixou de ser de desenho.
  if (ABERTO_RE.test(t)) return { vale: true, motivo: 'pergunta aberta de desenho — ha mais de uma forma certa, e a escolha merece alternativas isoladas' }
  if (s.lean) return { vale: false, motivo: 'mudanca cosmetica/visual/de aparencia sem pergunta aberta — nao ha alternativa de arquitetura a comparar' }
  return { vale: false, motivo: 'nada no enunciado indica pergunta de desenho — o padrao e nao multiplicar o custo por N' }
}
