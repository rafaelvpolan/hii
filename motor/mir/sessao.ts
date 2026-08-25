import { interpretarIntake } from './comandos-manuais.ts'
import { lerLinhaNaTarefa } from './pergunta.ts'
export type EffectKind =
  | 'none' | 'submit' | 'approve-plan' | 'historico'
  | 'halt' | 'plan' | 'help' | 'quit' | 'error'
  | 'approve-url' | 'reject-url' | 'reopen-repo'
  | 'answer' | 'rm' | 'confirm-rm' | 'instruct' | 'resume' | 'pick-repo' | 'acao-tarefa' | 'aprovacao' | 'ia' | 'consultar' | 'nova-sessao' | 'modelo' | 'esforco' | 'modo' | 'gauntlet' | 'situacao' | 'config' | 'ref' | 'login' | 'intake'

export interface SessionState {
  tela: '' | 'config'
  repo: string
  pendingPlan: string
  seguindo: string
  perguntando: string
  removendo: string
  retomando: string
  escolhendo: boolean
  aprovando: string
  comentando: string
  conversa: { pergunta: string; resposta: string }[]
}

export interface Effect {
  kind: EffectKind
  id?: string
  text?: string
  raw?: string
}

export interface Reply {
  effect: Effect
  state: SessionState
}

export const ALIASES: Record<string, string[]> = {
  '/repo': ['/project', '/projeto'],
  '/stop': ['/halt', '/parar'],
  '/exit': ['/quit', '/q'],
  '/rm': ['/apagar'],
  '/ia': ['/provedor'],
  '/model': ['/modelo'],
  '/effort': ['/esforco'],
  '/mode': ['/modo'],
  '/gauntlet': ['/crivo'],
  '/new-task': ['/nova-tarefa'],
  '/new-ask': ['/nova-pergunta'],
  '/new-session': ['/nova-sessao', '/new'],
  '/help': ['/h', '/?'],
  '/historico': ['/history'],
  '/config': ['/configuracao'],
  '/ref': ['/referencia', '/imagem'],
}

export function canonico(comando: string): string {
  for (const [principal, apelidos] of Object.entries(ALIASES)) {
    if (comando === principal || apelidos.includes(comando)) return principal
  }
  return comando
}

export const COMMANDS = ['/help', '/config', '/historico', '/ref', '/rm', '/stop', '/new-task', '/new-ask', '/new-session', '/repo', '/ia', '/model', '/effort', '/mode', '/gauntlet', '/login', '/exit',
  // Item 16 — atalhos de intake. Entram na MESMA lista porque sao comandos como
  // qualquer outro: o que muda e o conteudo pre-carregado, nunca o pipeline.
  '/orquestrador-jogos', '/orquestrador-dev-web', '/orquestrador-android', '/orquestrador-devops', '/layout'] as const

export function newSession(repo = ''): SessionState {
  return { tela: '', repo, pendingPlan: '', seguindo: '', perguntando: '', removendo: '', retomando: '', escolhendo: false, aprovando: '', comentando: '', conversa: [] }
}

export function perguntando(state: SessionState, id: string): SessionState {
  return { ...state, perguntando: id, pendingPlan: '' }
}

export function respondido(state: SessionState): SessionState {
  return { ...state, perguntando: '' }
}

export function comConversa(state: SessionState, pergunta: string, resposta: string): SessionState {
  return { ...state, conversa: [...state.conversa, { pergunta, resposta }].slice(-6) }
}

export function aprovando(state: SessionState, id: string): SessionState {
  return { ...state, aprovando: id, comentando: '', pendingPlan: '' }
}

export function comentando(state: SessionState, id: string): SessionState {
  return { ...state, aprovando: '', comentando: id }
}

export function semAprovacao(state: SessionState): SessionState {
  return { ...state, aprovando: '', comentando: '', conversa: [] }
}

function ocupado(state: SessionState): boolean {
  return !!(state.aprovando || state.comentando || state.pendingPlan
    || state.perguntando || state.removendo || state.retomando || state.escolhendo)
}

export function sincronizarAprovacao(state: SessionState, status: string): SessionState {
  if (!state.seguindo || status !== 'URL' || ocupado(state)) return state
  return aprovando(state, state.seguindo)
}

// Irmao de `sincronizarAprovacao`, para pergunta: a aprovacao de URL ja era detectada
// a cada desenho, e a pergunta nao. Uma pergunta que aparece DEPOIS que a pessoa
// entrou na tarefa (que e sempre o caso do crivo — ele so pergunta no fecho) ficava
// invisivel: `perguntando` so era ligado ao ESCOLHER o card no quadro.
export function sincronizarPergunta(state: SessionState, temPergunta: boolean): SessionState {
  if (!state.seguindo || !temPergunta || ocupado(state)) return state
  return perguntando(state, state.seguindo)
}

export function escolhendoRepo(state: SessionState): SessionState {
  return { ...state, escolhendo: true, pendingPlan: '', perguntando: '', removendo: '', retomando: '' }
}

export function retomando(state: SessionState, id: string): SessionState {
  return { ...state, retomando: id, pendingPlan: '', perguntando: '', removendo: '' }
}

export function removendo(state: SessionState, id: string): SessionState {
  return { ...state, removendo: id, pendingPlan: '', perguntando: '' }
}

export function seguir(state: SessionState, id: string): SessionState {
  return { ...state, seguindo: id }
}

export function foraDaTarefa(state: SessionState): SessionState {
  return { ...state, seguindo: '', aprovando: '', comentando: '' }
}

function reply(effect: Effect, state: SessionState): Reply {
  return { effect, state }
}

function command(line: string, state: SessionState): Reply {
  const [head, ...rest] = line.slice(1).trim().split(/\s+/)
  const arg = rest.join(' ')
  const cleared = { ...state, pendingPlan: '' }
  // Item 16. O atalho de intake NAO abre caminho proprio: ele vira um efeito que
  // o despachante manda pela mesma criacao de card de qualquer tarefa, so que
  // com os packs declarados junto. `raw` leva o nome do comando, e a lista de
  // packs continua morando num lugar so (comandos-manuais.ts).
  const intake = interpretarIntake(line)
  if (intake) {
    return intake.texto
      ? reply({ kind: 'intake', text: intake.texto, raw: intake.comando }, cleared)
      : reply({ kind: 'error', text: `uso: ${intake.comando} <o que fazer> — cria a tarefa com o conhecimento do dominio ja carregado` }, state)
  }
  switch (head) {
    case 'help':
    case 'h':
    case '?':
      return reply({ kind: 'help' }, state)
    case 'historico':
    case 'history':
      return reply({ kind: 'historico' }, { ...foraDaTarefa(state), tela: '' })
    case 'config':
    case 'configuracao':
      return reply({ kind: 'config' }, { ...foraDaTarefa(state), tela: 'config' })
    case 'halt':
    case 'stop':
    case 'parar':
      return rest[0]
        ? reply({ kind: 'halt', id: rest[0], text: rest.slice(1).join(' ') || 'parado pelo humano' }, cleared)
        : reply({ kind: 'error', text: 'uso: /stop <id> [motivo] — para a tarefa em execucao' }, state)
    case 'rm':
    case 'apagar':
      const alvos = rest.filter(a => !a.startsWith('-'))
      return alvos.length
        ? reply({ kind: 'rm', id: alvos.join(' '), text: rest.includes('--force') ? 'force' : '' }, cleared)
        : reply({ kind: 'error', text: 'uso: /rm <id> [id...] — apaga os cards e limpa worktree e url' }, state)
    case 'new-task':
    case 'nova-tarefa':
      return arg
        ? reply({ kind: 'submit', text: arg }, cleared)
        : reply({ kind: 'error', text: 'uso: /new-task <o que mudar> — cria a tarefa e enfileira direto' }, state)
    case 'new-ask':
    case 'nova-pergunta':
      return arg
        ? reply({ kind: 'consultar', text: arg }, cleared)
        : reply({ kind: 'error', text: 'uso: /new-ask <pergunta> — responde sem criar card' }, state)
    case 'ref':
    case 'referencia':
    case 'imagem':
      return reply({ kind: 'ref', text: arg }, state)
    case 'new-session':
    case 'nova-sessao':
    case 'new':
      return reply({ kind: 'nova-sessao' }, state)
    case 'ia':
    case 'provedor':
      return reply({ kind: 'ia', text: arg }, state)
    case 'model':
    case 'modelo':
      return reply({ kind: 'modelo', text: arg }, state)
    case 'effort':
    case 'esforco':
      return reply({ kind: 'esforco', text: arg }, state)
    case 'mode':
    case 'modo':
      return reply({ kind: 'modo', text: arg }, state)
    case 'gauntlet':
    case 'crivo':
      return reply({ kind: 'gauntlet', text: arg }, state)

    case 'login':
      return reply({ kind: 'login', text: arg }, state)
    case 'repo':
    case 'project':
    case 'projeto':
      return arg
        ? reply({ kind: 'pick-repo', text: arg }, { ...state, escolhendo: false })
        : reply({ kind: 'reopen-repo' }, state)
    case 'quit':
    case 'exit':
    case 'q':
      return reply({ kind: 'quit' }, state)
    default:
      return reply({ kind: 'error', id: head, text: `comando desconhecido: /${head} — tente /help`, raw: [head, ...rest].join(' ') }, state)
  }
}

export function handle(raw: string, state: SessionState): Reply {
  const line = raw.trim()
  if (!line) {
    if (state.comentando) return reply({ kind: 'none' }, semAprovacao(state))
    if (state.escolhendo) return reply({ kind: 'none' }, { ...state, escolhendo: false })
    if (state.retomando) return reply({ kind: 'resume', id: state.retomando }, { ...state, retomando: '' })
    if (state.removendo) return reply({ kind: 'confirm-rm', id: state.removendo, text: 'sim' }, { ...state, removendo: '' })
    if (state.perguntando) return reply({ kind: 'answer', id: state.perguntando, text: '' }, state)
    if (state.pendingPlan) return reply({ kind: 'approve-plan', id: state.pendingPlan }, { ...state, pendingPlan: '' })
    if (state.seguindo) return reply({ kind: 'acao-tarefa', id: state.seguindo }, state)
    return reply({ kind: 'none' }, state)
  }
  if (line.startsWith('/')) return command(line, state)
  if (state.comentando) {
    return reply({ kind: 'reject-url', id: state.comentando, text: line }, semAprovacao(state))
  }
  if (state.aprovando && /^[123]$/.test(line)) {
    return reply({ kind: 'aprovacao', id: state.aprovando, text: line }, state)
  }
  if (state.escolhendo) {
    return reply({ kind: 'pick-repo', text: line }, { ...state, escolhendo: false })
  }
  if (state.retomando) return handle(line, { ...state, retomando: '' })
  if (state.removendo) {
    const nao = /^(n|nao|não|no|c|cancel\w*)$/i.test(line)
    return reply({ kind: 'confirm-rm', id: state.removendo, text: nao ? '' : 'sim' }, { ...state, removendo: '' })
  }
  if (state.perguntando) {
    return reply({ kind: 'answer', id: state.perguntando, text: line }, state)
  }
  if (/^#?\d{1,4}$/.test(line)) {
    return reply({ kind: 'plan', id: line.replace('#', '') }, state)
  }
  if (state.seguindo) {
    // Pergunta dentro da tarefa era anexada ao card como instrucao e nunca
    // respondida. Agora ela e lida como pergunta e respondida na hora — e `!` no
    // comeco forca instrucao, para a heuristica ter escape.
    const leitura = lerLinhaNaTarefa(line)
    if (leitura.tipo === 'pergunta') {
      return reply({ kind: 'situacao', id: state.seguindo, text: leitura.texto }, state)
    }
    return reply({ kind: 'instruct', id: state.seguindo, text: leitura.texto }, state)
  }
  if (state.pendingPlan) {
    return reply({ kind: 'submit', text: line }, { ...state, pendingPlan: '' })
  }
  return reply({ kind: 'submit', text: line }, state)
}

export function planShown(state: SessionState, id: string): SessionState {
  return { ...state, pendingPlan: id }
}
