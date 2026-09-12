import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { semControle } from '../../cordel/util.ts'

export function carimboAgora(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z')
}

export function cabecalhoDaChamada(ts: string, rotulo = ''): string {
  return `— chamada em ${ts}${rotulo ? ` · ${rotulo}` : ''} —`
}

export function linhaDeConclusao(custoUsd?: number): string {
  return typeof custoUsd === 'number' ? `— concluido (custo $${custoUsd.toFixed(4)}) —` : '— concluido —'
}

export function comRaia(texto: string, raia = ''): string {
  if (!raia) return texto
  return texto.split('\n').map(l => (l.length ? `[${raia}] ${l}` : l)).join('\n')
}

export interface ChamadaParaOLog {
  readonly caminho: string
  readonly rotulo?: string
  readonly raia?: string
  readonly linhas: readonly string[]
  readonly custoUsd?: number
}

export function gravarChamadaNoLiveLog(c: ChamadaParaOLog): void {
  try {
    const dir = dirname(c.caminho)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const corpo = [
      '',
      cabecalhoDaChamada(carimboAgora(), c.rotulo),
      ...c.linhas.map(l => semControle(l)),
      linhaDeConclusao(c.custoUsd),
    ].join('\n')
    appendFileSync(c.caminho, `${comRaia(corpo, c.raia)}\n`)
  } catch {
    void 0
  }
}
