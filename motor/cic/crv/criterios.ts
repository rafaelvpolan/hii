import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../../cdl/ali/config.ts'
import { ENV_CRITERIOS_FILE } from '../../cdl/ali/contrato.ts'

// CRV — o criterio escrito. Antes os padroes viviam numa string dentro do
// prompt do gate: nao davam para versionar, auditar nem citar numa reprovacao.
// Agora o crivo reprova contra um id, e quem le a reprovacao sabe o que
// consertar sem adivinhar o que o modelo quis dizer.

export interface CriterioDeReview {
  readonly id: string
  readonly titulo: string
  readonly checa: string
}

export interface CenarioObrigatorio {
  readonly id: string
  readonly cenario: string
  readonly quando: string
}

export interface CriterioDoCrivo {
  readonly versao: number
  readonly criterios: readonly CriterioDeReview[]
  readonly cenarios: readonly CenarioObrigatorio[]
}

interface Cru {
  versao?: number
  criterios?: CriterioDeReview[]
  matrizDeCenario?: { obrigatorios?: CenarioObrigatorio[] }
}

export function arquivoDeCriterios(): string {
  return process.env[ENV_CRITERIOS_FILE] || join(ROOT, 'config', 'review-criteria.json')
}

export function lerCriterios(): CriterioDoCrivo {
  const caminho = arquivoDeCriterios()
  // Ausente ou ilegivel LANCA. Cair para "sem criterio" faria o gate voltar a
  // julgar por impressao, silenciosamente — que e exatamente o que o item 8
  // existe para acabar.
  if (!existsSync(caminho)) throw new Error(`review-criteria.json nao encontrado em ${caminho} — o crivo nao julga sem criterio escrito`)
  let cru: Cru
  try {
    cru = JSON.parse(readFileSync(caminho, 'utf8')) as Cru
  } catch (e) {
    throw new Error(`review-criteria.json ilegivel (${String((e as Error).message)})`)
  }
  const criterios = cru.criterios ?? []
  if (!criterios.length) throw new Error('review-criteria.json sem criterio nenhum — lista vazia deixaria o gate sem regra')
  for (const c of criterios) {
    if (!c.id || !c.checa) throw new Error(`criterio sem id ou sem "checa": ${JSON.stringify(c).slice(0, 120)}`)
  }
  return { versao: cru.versao ?? 0, criterios, cenarios: cru.matrizDeCenario?.obrigatorios ?? [] }
}

export function idsDeCriterio(c: CriterioDoCrivo = lerCriterios()): string[] {
  return c.criterios.map(x => x.id)
}

export function renderizarCriterios(c: CriterioDoCrivo = lerCriterios()): string {
  const linhas = c.criterios.map(x => `- [${x.id}] ${x.titulo}: ${x.checa}`)
  const cenarios = c.cenarios.map(x => `- [${x.id}] ${x.cenario} (${x.quando})`)
  return [
    `CRITERIO DE REVISAO (config/review-criteria.json v${c.versao}) — julgue contra ISTO, nao por impressao:`,
    ...linhas,
    '',
    'MATRIZ DE CENARIO — o teste da feature precisa cobrir:',
    ...cenarios,
    '',
    'Ao reprovar, cite o id do criterio violado (ex: c-erro). Reprovacao sem id nao diz ao implementador o que consertar.',
  ].join('\n')
}
