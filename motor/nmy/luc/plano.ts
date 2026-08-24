import { extractObjetivo } from '../../cdl/index.ts'
import type { Card } from '../../cdl/index.ts'
import { planSteps, valeDivergir } from '../../osw/rta/perfil.ts'
import { classifySurface } from '../../osw/rta/superficie.ts'
import { lerEscopo } from '../../osw/rta/escopo.ts'
import { objetivoComInstrucoes } from '../../mir/instruir.ts'
import type { EscopoDeEscrita } from '../../osw/rta/escopo.ts'
import { activeSteps } from '../config.ts'
import { waves } from './ondas.ts'
import type { PipelineStep } from '../tipos.ts'

export interface PlanWave {
  n: number
  steps: PipelineStep[]
}

export interface PlanFlags {
  on: boolean
  reason: string
}

export interface Plan {
  id: string
  title: string
  objetivo: string
  repo: string
  profile: string
  profileReason: string
  layout: PlanFlags
  pilha: PlanFlags
  divergencia: PlanFlags
  waves: PlanWave[]
  skipped: string[]
  gatedLabels: string[]
  // Onde o motor pode ESCREVER e o que e so referencia, lido do proprio pedido.
  // Vai para o plano porque restringir escrita sem o humano ver seria surpresa — e
  // o plano e onde ele aprova antes de qualquer gasto.
  escopo: EscopoDeEscrita
}

export interface PlanInput {
  card: Card
  hasDevServer: boolean
  fileCount?: number
  sliceLimit?: number
  // Checagem de existencia dos caminhos citados, para prosa com barra
  // ("feito/executado em ...") nao virar caminho. Ausente = le so pela forma.
  existeNoAlvo?: (caminho: string) => boolean
}

const SUBJETIVO = /\b(?:melhor\w*|chamativ\w*|bonit\w*|moderniz\w*|refin\w*|aparencia|estil\w*|design|visual\w*|layout|ux)\b/

function norm(s: string | undefined): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function layoutFlag(card: Card, surfaceVisual: boolean, objetivo: string): PlanFlags {
  if (card.fm.layout === 'on') return { on: true, reason: 'ligado no card' }
  if (card.fm.layout === 'off') return { on: false, reason: 'desligado no card' }
  if (!surfaceVisual) return { on: false, reason: 'tarefa sem superficie visual' }
  const m = ` ${norm(card.fm.title)} ${norm(objetivo)} `.match(SUBJETIVO)
  return m?.[0]
    ? { on: false, reason: `visual subjetivo ("${m[0]}") — sugerido, ligue com layout: on` }
    : { on: false, reason: 'visual localizado — layout nao ajuda' }
}

function pilhaFlag(card: Card, fileCount: number, limit: number): PlanFlags {
  if (card.fm.pilha === 'on') return { on: true, reason: 'ligado no card' }
  if (fileCount > limit) return { on: false, reason: `${fileCount} arquivos > teto ${limit} — sugerido, ligue com pilha: on` }
  return { on: false, reason: `${fileCount} arquivo(s), teto ${limit}` }
}

// MCN entra na Fase 3, e entra COMO FLAG VISIVEL. Divergir multiplica o custo
// por N: uma decisao dessas nao pode acontecer sem aparecer no plano que o
// humano le antes de aprovar. Mesmo formato de layout e pilha, de proposito.
function divergenciaFlag(card: Card, objetivo: string, surface: string): PlanFlags {
  const v = valeDivergir({
    title: card.fm.title, objetivo, risk: card.fm.risk, surface,
    divergir: card.fm.divergir,
  })
  return { on: v.vale, reason: v.motivo }
}

export function buildPlan(input: PlanInput): Plan {
  const { card } = input
  const objetivo = extractObjetivo(card.body) || card.fm.title || ''
  const surface = card.fm.surface || classifySurface(card.fm.title ?? '', objetivo, input.hasDevServer).surface
  const all = activeSteps()
  const plan = planSteps(
    { title: card.fm.title, objetivo, risk: card.fm.risk, surface, override: card.fm.steps },
    all,
  )
  return {
    id: card.fm.id ?? '',
    title: card.fm.title ?? '',
    objetivo,
    repo: card.fm.repo ?? '',
    profile: plan.profile,
    profileReason: plan.reason,
    layout: layoutFlag(card, surface === 'visual', objetivo),
    pilha: pilhaFlag(card, input.fileCount ?? 0, input.sliceLimit ?? 30),
    divergencia: divergenciaFlag(card, objetivo, surface),
    waves: waves(plan.steps).map((steps, i) => ({ n: i + 1, steps })),
    skipped: plan.skipped,
    gatedLabels: plan.steps.filter(s => s.gated).map(s => s.label),
    // MESMO texto que o motor le em `escopoDoCard` (title + objetivo COM instrucoes):
    // o plano nao pode prometer um escopo e a execucao aplicar outro. Instrucao
    // anexada depois do plano entra nos dois lados junto.
    escopo: lerEscopo(`${card.fm.title ?? ''} ${objetivoComInstrucoes(card.body, card.fm.title ?? '')}`, input.existeNoAlvo),
  }
}
