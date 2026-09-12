// Cartorio — a DECISAO do pipeline manual como funcao pura, num lugar so. Antes
// ela vivia inline em fechar.ts, espalhada em tres trechos, e a invariante "um
// passo nunca e pago duas vezes" nao tinha onde ser testada sozinha. Tres regras
// desta peca vem de defeitos observados no raio-x:
// - pipeline_feitos passa a guardar IDs (renomear um label em config/pipeline.json
//   fazia passo ja pago rodar de novo, em silencio); labels legados seguem aceitos.
// - pedido de passo unico VENCE uma liberacao grudada: pipeline_liberado ficava
//   escrito apos um HALT no meio da suite, e o /polimento seguinte era descartado
//   depois de a TUI ter respondido que rodaria so um passo.
// - quem escreve os campos e o cartorio (passos-manuais.ts); fechar.ts obedece a
//   decisao daqui e faz apenas os patches.
import type { PipelineStep } from '../../niemeyer/tipos.ts'

export const RESUME_POST_STEPS = '__apos_passos__'

export interface PlanoDePassos {
  steps: PipelineStep[]
  profile: string
}

export interface EntradaDoPlanoManual {
  manual: boolean
  passoUnico: string
  liberado: boolean
  feitosCru: string
  resumeFrom: string
  plano: PlanoDePassos
  all: PipelineStep[]
}

export interface Retomada {
  indice: number
  foraDoPerfil: boolean
}

export interface PlanoRodar {
  tipo: 'rodar'
  vaoRodar: PipelineStep[]
  feitos: string[]
  passoUnicoAtivo: string
  liberacaoCaducada: boolean
  repetido: boolean
  retomada: Retomada
}

export interface PlanoPausar {
  tipo: 'pausar'
  motivo: string
  restantes: PipelineStep[]
  feitos: string[]
  retomada: Retomada
}

export type PlanoManual = PlanoRodar | PlanoPausar

export function feitosDoCard(cru: string | undefined): string[] {
  return String(cru ?? '').split(',').map(s => s.trim()).filter(Boolean)
}

function jaPago(step: PipelineStep, feitos: string[]): boolean {
  return feitos.includes(step.id) || feitos.includes(step.label)
}

export function passosRestantes(steps: PipelineStep[], feitos: string[]): PipelineStep[] {
  return steps.filter(s => !jaPago(s, feitos))
}

export function anotarPago(feitos: string[], step: PipelineStep): string[] {
  return jaPago(step, feitos) ? feitos : [...feitos, step.id]
}

function mesmoPasso(step: PipelineStep, nome: string): boolean {
  return step.label === nome || step.id === nome
}

export function indiceDeRetomada(steps: PipelineStep[], all: PipelineStep[], resumeFrom: string): Retomada {
  if (!resumeFrom) return { indice: 0, foraDoPerfil: false }
  if (resumeFrom === RESUME_POST_STEPS) return { indice: steps.length, foraDoPerfil: false }
  const exato = steps.findIndex(s => mesmoPasso(s, resumeFrom))
  if (exato >= 0) return { indice: exato, foraDoPerfil: false }
  const posicaoPedida = all.findIndex(s => mesmoPasso(s, resumeFrom))
  const seguinte = posicaoPedida < 0 ? -1 : steps.findIndex(s => all.findIndex(a => a.id === s.id) >= posicaoPedida)
  return { indice: seguinte >= 0 ? seguinte : steps.length, foraDoPerfil: true }
}

export function quaisPassosRodar(e: EntradaDoPlanoManual): PlanoManual {
  const retomada = indiceDeRetomada(e.plano.steps, e.all, e.resumeFrom)
  const aposRetomada = e.plano.steps.slice(retomada.indice)
  if (!e.manual) {
    return { tipo: 'rodar', vaoRodar: aposRetomada, feitos: [], passoUnicoAtivo: '', liberacaoCaducada: false, repetido: false, retomada }
  }
  const feitos = feitosDoCard(e.feitosCru)
  const restantes = passosRestantes(aposRetomada, feitos)
  if (e.passoUnico) {
    const alvo = aposRetomada.find(s => s.id === e.passoUnico)
    if (!alvo) {
      return { tipo: 'pausar', motivo: `passo manual "${e.passoUnico}" nao esta no plano deste card (nao se aplica ao perfil ${e.plano.profile} ou fica antes do ponto de retomada)`, restantes, feitos, retomada }
    }
    const repetido = jaPago(alvo, feitos)
    const dependenciasEmFalta = (alvo.needs ?? [])
      .filter(n => {
        const dep = e.all.find(a => a.id === n)
        return dep ? !jaPago(dep, feitos) : !feitos.includes(n)
      })
      .map(n => e.all.find(a => a.id === n)?.label ?? n)
    if (dependenciasEmFalta.length) {
      return { tipo: 'pausar', motivo: `passo manual "${e.passoUnico}" depende de [${dependenciasEmFalta.join(', ')}] — rode antes`, restantes, feitos, retomada }
    }
    return { tipo: 'rodar', vaoRodar: [alvo], feitos, passoUnicoAtivo: e.passoUnico, liberacaoCaducada: e.liberado, repetido, retomada }
  }
  if (e.liberado || !restantes.length) {
    return { tipo: 'rodar', vaoRodar: restantes, feitos, passoUnicoAtivo: '', liberacaoCaducada: false, repetido: false, retomada }
  }
  return { tipo: 'pausar', motivo: '', restantes, feitos, retomada }
}
