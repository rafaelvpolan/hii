import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isoNow } from '../../cdl/index.ts'

// FRE — o candidato a regra. Acumula SEM efeito no gate.
//
// O limiar existe porque falha isolada e ruido, nao padrao. Promover na primeira
// vez produziria bloqueio permanente a partir de um caso mal interpretado — o
// risco simetrico ao de nunca aprender, e o mais caro dos dois porque ninguem
// desfaz regra errada depois que ela vira gate.
//
// Ocorrencia e por CARD, nao por evento: um card com build instavel dispara o
// mesmo gate cinco vezes, e contar isso como cinco cards faria um unico
// problema local inventar um padrao global.

export const LIMIAR_DE_PROMOCAO = 3

export interface Ocorrencia {
  readonly card: string
  readonly evidencia: string
  readonly ts: string
}

export interface CandidatoDeRegra {
  readonly assinatura: string
  readonly categoria: string
  readonly promovido: boolean
  readonly ocorrencias: readonly Ocorrencia[]
}

export interface NovaOcorrencia {
  readonly assinatura: string
  readonly categoria: string
  readonly card: string
  readonly evidencia: string
}

function diretorio(alvo: string): string {
  return join(alvo, '.hii', 'candidatos-regras')
}

function arquivo(alvo: string, assinatura: string): string {
  return join(diretorio(alvo), `${assinatura}.json`)
}

function ler(caminho: string): CandidatoDeRegra | null {
  if (!existsSync(caminho)) return null
  try {
    return JSON.parse(readFileSync(caminho, 'utf8')) as CandidatoDeRegra
  } catch (e) {
    throw new Error(`candidato ilegivel em ${caminho} (${String((e as Error).message)}) — recuse trabalhar sem ele em vez de tratar como lista vazia`)
  }
}

export function registrarOcorrencia(alvo: string, nova: NovaOcorrencia): CandidatoDeRegra {
  if (!nova.evidencia.trim()) {
    throw new Error('ocorrencia sem evidencia do diario — candidato sem prova e opiniao, e opiniao nao vira regra')
  }
  const caminho = arquivo(alvo, nova.assinatura)
  const atual = ler(caminho)
  const jaTemEsteCard = (atual?.ocorrencias ?? []).some(o => o.card === nova.card)
  const ocorrencias = jaTemEsteCard
    ? (atual?.ocorrencias ?? [])
    : [...(atual?.ocorrencias ?? []), { card: nova.card, evidencia: nova.evidencia.slice(0, 300), ts: isoNow() }]
  const candidato: CandidatoDeRegra = {
    assinatura: nova.assinatura,
    categoria: nova.categoria,
    promovido: atual?.promovido ?? false,
    ocorrencias,
  }
  mkdirSync(diretorio(alvo), { recursive: true })
  writeFileSync(caminho, `${JSON.stringify(candidato, null, 2)}\n`)
  return candidato
}

export function candidatos(alvo: string): CandidatoDeRegra[] {
  const dir = diretorio(alvo)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(n => n.endsWith('.json'))
    .map(n => ler(join(dir, n)))
    .filter((c): c is CandidatoDeRegra => c !== null)
    .sort((a, b) => a.assinatura.localeCompare(b.assinatura))
}

export function atingiuLimiar(c: CandidatoDeRegra, limiar: number = LIMIAR_DE_PROMOCAO): boolean {
  return c.ocorrencias.length >= limiar
}

export function prontosParaRevisao(alvo: string, limiar: number = LIMIAR_DE_PROMOCAO): CandidatoDeRegra[] {
  return candidatos(alvo).filter(c => !c.promovido && atingiuLimiar(c, limiar))
}
