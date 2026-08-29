import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../../cordel/alicerce/config.ts'
import { ENV_ENQUADRAMENTOS_FILE } from '../../cordel/alicerce/contrato.ts'

// MCN — Macunaima. O heroi de muitas faces atravessa o pais mudando de forma:
// um problema visto por N personagens, sem que nenhum seja "o" certo.
//
// Este modulo so carrega os enquadramentos. Eles sao DADO versionado porque
// lente hardcoded nao se audita: ninguem revisa um array no meio de um .ts, e
// mudar o comportamento da divergencia deixaria de aparecer no diff como
// mudanca de comportamento. Mesma disciplina do CRV com review-criteria.json.

export interface Enquadramento {
  readonly id: string
  readonly nome: string
  readonly lente: string
}

export interface Enquadramentos {
  readonly versao: number
  readonly minimoDeRamos: number
  readonly enquadramentos: readonly Enquadramento[]
}

interface Cru {
  versao?: number
  minimoDeRamos?: number
  enquadramentos?: Enquadramento[]
}

export function arquivoDeEnquadramentos(): string {
  return process.env[ENV_ENQUADRAMENTOS_FILE] || join(ROOT, 'config', 'enquadramentos.json')
}

export function lerEnquadramentos(): Enquadramentos {
  const caminho = arquivoDeEnquadramentos()
  // Ausente ou ilegivel LANCA. Cair para uma lista embutida devolveria o
  // problema que este arquivo existe para resolver — a divergencia rodaria com
  // lentes que ninguem versionou, e o operador nao saberia com quais rodou.
  if (!existsSync(caminho)) {
    throw new Error(`enquadramentos.json nao encontrado em ${caminho} — o MCN nao diverge sem lente escrita`)
  }
  let cru: Cru
  try {
    cru = JSON.parse(readFileSync(caminho, 'utf8')) as Cru
  } catch (e) {
    throw new Error(`enquadramentos.json ilegivel (${String((e as Error).message)})`)
  }
  const lista = cru.enquadramentos ?? []
  if (!lista.length) throw new Error('enquadramentos.json sem enquadramento nenhum — lista vazia deixaria a divergencia sem ramo')
  const vistos = new Set<string>()
  for (const e of lista) {
    if (!e.id?.trim() || !e.lente?.trim()) {
      throw new Error(`enquadramento sem id ou sem "lente": ${JSON.stringify(e).slice(0, 120)}`)
    }
    // Id repetido faria dois ramos votarem sob o mesmo nome, e o VTO recusa
    // lente duplicada na apuracao. Barrar aqui aponta o arquivo; barrar la
    // apontaria a apuracao, longe da causa.
    if (vistos.has(e.id)) throw new Error(`enquadramento "${e.id}" repetido — dois ramos com o mesmo id falseariam o placar do VTO`)
    vistos.add(e.id)
  }
  const minimo = Number(cru.minimoDeRamos ?? 3)
  if (!Number.isFinite(minimo) || minimo < 2) {
    throw new Error(`minimoDeRamos=${String(cru.minimoDeRamos)} invalido — divergir com menos de 2 ramos nao e divergir`)
  }
  return { versao: cru.versao ?? 0, minimoDeRamos: minimo, enquadramentos: lista }
}

export function idsDeEnquadramento(e: Enquadramentos = lerEnquadramentos()): string[] {
  return e.enquadramentos.map(x => x.id)
}

// Escolha deterministica: a mesma semente devolve os mesmos ramos. Sorteio real
// tornaria a divergencia irreprodutivel — dois cards iguais dariam planos
// diferentes sem que ninguem soubesse por que.
export function escolherEnquadramentos(quantos: number, semente: string, fonte: Enquadramentos = lerEnquadramentos()): Enquadramento[] {
  const todos = fonte.enquadramentos
  const n = Math.max(fonte.minimoDeRamos, Math.min(quantos, todos.length))
  if (todos.length < fonte.minimoDeRamos) {
    throw new Error(`enquadramentos.json tem ${todos.length} lente(s) e minimoDeRamos=${fonte.minimoDeRamos} — nao da para formar maioria`)
  }
  const base = [...semente].reduce((a, c) => a + c.charCodeAt(0), 0)
  const escolhidos: Enquadramento[] = []
  for (let i = 0; escolhidos.length < n && i < todos.length; i++) {
    const cand = todos[(base + i) % todos.length]
    if (cand && !escolhidos.includes(cand)) escolhidos.push(cand)
  }
  for (const e of todos) {
    if (escolhidos.length >= n) break
    if (!escolhidos.includes(e)) escolhidos.push(e)
  }
  return escolhidos.slice(0, n)
}
