import type { Plan, PlanWave } from '../../nmy/luc/plano.ts'

const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'
const ACC = '\x1b[36m'
const WARN = '\x1b[33m'

export interface RenderOptions {
  color: boolean
  width: number
}

export const DEFAULT_RENDER: RenderOptions = { color: false, width: 78 }

function paint(s: string, code: string, o: RenderOptions): string {
  return o.color ? `${code}${s}${RESET}` : s
}

function rule(label: string, o: RenderOptions): string {
  const head = label ? `── ${label} ` : '── '
  return paint(head + '─'.repeat(Math.max(0, o.width - head.length)), DIM, o)
}

function oneLine(s: string, max: number): string {
  const flat = String(s || '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}

function flag(name: string, on: boolean, reason: string, o: RenderOptions): string {
  const mark = paint((on ? 'SIM' : 'nao').padEnd(4), on ? ACC : DIM, o)
  return `    ${name.padEnd(10)} ${mark}  ${paint(oneLine(reason, o.width - 22), DIM, o)}`
}

function waveLine(w: PlanWave, o: RenderOptions): string[] {
  if (w.steps.length === 1) {
    const s = w.steps[0]
    if (!s) return []
    const gate = s.gated ? paint(' [crivo]', DIM, o) : ''
    return [`    ${paint(`${w.n}.`, ACC, o)} ${s.label.padEnd(14)} ${paint(s.agent, DIM, o)}${gate}`]
  }
  const out: string[] = []
  w.steps.forEach((s, i) => {
    const bracket = i === 0 ? '┌' : i === w.steps.length - 1 ? '└' : '│'
    const prefix = i === 0 ? `    ${paint(`${w.n}.`, ACC, o)} ` : '       '
    const gate = s.gated ? paint(' [crivo]', DIM, o) : ''
    const tail = i === 0 ? paint('  ← paralelo', WARN, o) : ''
    out.push(`${prefix}${bracket} ${s.label.padEnd(14)} ${paint(s.agent, DIM, o)}${gate}${tail}`)
  })
  return out
}

// Comando a esquerda, explicacao a direita, e o conjunto nunca passa da largura.
function linhaDeAjuda(comando: string, explicacao: string, o: RenderOptions): string {
  const cmd = oneLine(comando, Math.max(8, o.width - 12))
  const sobra = o.width - 4 - cmd.length - 2
  const nota = sobra > 6 ? `  ${paint(oneLine(explicacao, sobra), DIM, o)}` : ''
  return `    ${cmd}${nota}`
}

function linhasDeEscopo(e: Plan['escopo'], o: RenderOptions): string[] {
  if (!e.alvos.length && !e.referencias.length) return []
  const fora: string[] = []
  // `Escreve` / `So le`, e nao `Alvo`: a linha `Alvo` acima ja quer dizer o REPO, e
  // duas etiquetas iguais com sentidos diferentes na mesma tela e pior que nenhuma.
  if (e.alvos.length) {
    fora.push(`    ${'Escreve'.padEnd(10)} ${paint(oneLine(e.alvos.join(' · '), o.width - 20), WARN, o)}`)
  }
  if (e.referencias.length) {
    fora.push(`    ${'So le'.padEnd(10)} ${paint(oneLine(e.referencias.join(' · '), o.width - 20), DIM, o)}`)
  }
  return fora
}

export function renderPlan(plan: Plan, opts: Partial<RenderOptions> = {}): string {
  const o = { ...DEFAULT_RENDER, ...opts }
  const out: string[] = []
  out.push(paint(`PLANO · card #${plan.id}`, BOLD, o) + paint(`   perfil ${plan.profile}`, DIM, o))
  out.push('')
  out.push(`    ${'Objetivo'.padEnd(10)} ${oneLine(plan.objetivo, o.width - 16)}`)
  out.push(`    ${'Alvo'.padEnd(10)} ${oneLine(plan.repo, o.width - 16)}`)
  out.push(flag('Layout', plan.layout.on, plan.layout.reason, o))
  out.push(flag('Pilha', plan.pilha.on, plan.pilha.reason, o))
  // Item 33. Divergir multiplica o custo por N, entao a decisao nao pode acontecer
  // sem aparecer no plano que o humano aprova. O campo existia em buildPlan desde a
  // Onda 12 e nenhum renderizador o lia — a promessa estava no comentario, nao na tela.
  out.push(flag('Divergir', plan.divergencia.on, plan.divergencia.reason, o))
  // ESCOPO na tela, e nao so no objeto: o agente editou a REFERENCIA porque nada
  // distinguia "leia aqui" de "escreva ali", e restringir escrita sem o humano ver
  // seria trocar uma surpresa por outra. Aqui ele aprova sabendo.
  for (const linha of linhasDeEscopo(plan.escopo, o)) out.push(linha)
  out.push('')
  out.push(rule('Realizacao', o))
  if (!plan.waves.length) out.push(paint('    (nenhum passo de polimento neste perfil)', DIM, o))
  for (const w of plan.waves) out.push(...waveLine(w, o))
  if (plan.skipped.length) {
    out.push('')
    out.push(`    ${paint('pula', DIM, o)} ${oneLine(plan.skipped.join(', '), o.width - 11)}`)
  }
  out.push(`    ${paint('motivo', DIM, o)} ${oneLine(plan.profileReason, o.width - 13)}`)
  out.push('')
  out.push(rule('Execucao', o))
  // As tres linhas de ajuda eram strings fixas e estouravam a largura em terminal
  // estreito (74 colunas num terminal de 60) — a mesma classe que a rolagem
  // horizontal da entrada acabou de consertar, e que os campos acima ja evitavam
  // com `oneLine`. `motivo` e `pula` tambem passam a ser cortados.
  out.push(linhaDeAjuda(`hii approve ${plan.id} --plan`, 'aprova o plano e enfileira', o))
  out.push(linhaDeAjuda(`hii halt ${plan.id} "motivo"`, 'descarta o card', o))
  out.push(`    ${paint(oneLine('no REPL: enter aprova o plano · dentro da tarefa, 1 aprova o resultado', o.width - 8), DIM, o)}`)
  out.push('')
  out.push(paint('    Nada foi executado.', WARN, o))
  return out.join('\n')
}
