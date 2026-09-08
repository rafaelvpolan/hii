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

export interface EntradaDoPlanoManual {
  manual: boolean
  passoUnico: string
  liberado: boolean
  feitosCru: string
  aposRetomada: PipelineStep[]
  all: PipelineStep[]
  profile: string
}

export interface PlanoRodar {
  tipo: 'rodar'
  vaoRodar: PipelineStep[]
  feitos: string[]
  passoUnicoAtivo: string
  liberacaoCaducada: boolean
}

export interface PlanoPausar {
  tipo: 'pausar'
  motivo: string
  restantes: PipelineStep[]
  feitos: string[]
}

export type PlanoManual = PlanoRodar | PlanoPausar

export function feitosDoCard(cru: string | undefined): string[] {
  return String(cru ?? '').split(',').map(s => s.trim()).filter(Boolean)
}

function jaPago(step: PipelineStep, feitos: string[]): boolean {
  return feitos.includes(step.id) || feitos.includes(step.label)
}

export function quaisPassosRodar(e: EntradaDoPlanoManual): PlanoManual {
  if (!e.manual) {
    return { tipo: 'rodar', vaoRodar: e.aposRetomada, feitos: [], passoUnicoAtivo: '', liberacaoCaducada: false }
  }
  const feitos = feitosDoCard(e.feitosCru)
  const restantes = e.aposRetomada.filter(s => !jaPago(s, feitos))
  if (e.passoUnico) {
    const alvo = restantes.find(s => s.id === e.passoUnico)
    if (!alvo) {
      return { tipo: 'pausar', motivo: `passo manual "${e.passoUnico}" nao esta no plano deste card (ja rodou ou nao se aplica ao perfil ${e.profile})`, restantes, feitos }
    }
    const dependenciasEmFalta = (alvo.needs ?? [])
      .filter(n => {
        const dep = e.all.find(a => a.id === n)
        return dep ? !jaPago(dep, feitos) : !feitos.includes(n)
      })
      .map(n => e.all.find(a => a.id === n)?.label ?? n)
    if (dependenciasEmFalta.length) {
      return { tipo: 'pausar', motivo: `passo manual "${e.passoUnico}" depende de [${dependenciasEmFalta.join(', ')}] — rode antes`, restantes, feitos }
    }
    return { tipo: 'rodar', vaoRodar: [alvo], feitos, passoUnicoAtivo: e.passoUnico, liberacaoCaducada: e.liberado }
  }
  if (e.liberado || !restantes.length) {
    return { tipo: 'rodar', vaoRodar: restantes, feitos, passoUnicoAtivo: '', liberacaoCaducada: false }
  }
  return { tipo: 'pausar', motivo: '', restantes, feitos }
}
