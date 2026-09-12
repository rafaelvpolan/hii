import { isoNow } from '../../cordel/index.ts'
import { patchCard } from '../../cordel/store.ts'
import type { PipelineStep } from '../../niemeyer/tipos.ts'
import { indiceDeRetomada, RESUME_POST_STEPS } from './plano-de-passos.ts'
import type { Retomada } from './plano-de-passos.ts'

export { RESUME_POST_STEPS }

export function avisoDeRetomadaForaDoPerfil(resumeFrom: string, profile: string, retomada: Retomada, totalDePassos: number): string {
  const destino = retomada.indice < totalDePassos ? 'retomando do passo aplicavel seguinte' : 'nada a repetir — seguindo para revalidacao/PR'
  return `${isoNow()} replay: passo "${resumeFrom}" nao roda neste card (perfil ${profile}); ${destino}`
}

export function resumeStart(steps: PipelineStep[], all: PipelineStep[], resumeFrom: string, id: string, profile: string): number {
  const retomada = indiceDeRetomada(steps, all, resumeFrom)
  if (retomada.foraDoPerfil) patchCard(id, {}, avisoDeRetomadaForaDoPerfil(resumeFrom, profile, retomada, steps.length))
  return retomada.indice
}
