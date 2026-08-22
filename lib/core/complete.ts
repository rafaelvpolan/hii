import { COMMANDS, canonico } from './session'
import { PALAVRAS_DE_CLIPBOARD } from './refs-comando'

export interface CompleteContext {
  repos: string[]
  cards: string[]
  provedores?: string[]
  modelos?: string[]
  esforcos?: string[]
  modos?: string[]
  papeis?: string[]
  comandosDaIa?: string[]
}

export type Completion = [string[], string]

function byPrefix(all: string[], prefix: string): string[] {
  const hits = all.filter(a => a.startsWith(prefix))
  return hits.length ? hits : []
}

export function complete(line: string, ctx: CompleteContext): Completion {
  if (!line.startsWith('/')) return [[], line]
  const partes = line.split(/\s+/)
  const head = partes[0] ?? ''

  if (partes.length === 1) {
    const hii = byPrefix([...COMMANDS], head)
    const daIa = byPrefix(ctx.comandosDaIa ?? [], head).filter(c => !hii.includes(c))
    const teto = hii.length ? hii.length : Math.min(6, daIa.length)
    return [[...hii, ...daIa.slice(0, teto)], head]
  }

  const arg = partes[partes.length - 1] ?? ''
  if (partes.length > 2) return [[], arg]

  const principal = canonico(head)
  if (principal === '/ia' || principal === '/login') return [byPrefix([...(ctx.papeis ?? []), ...(ctx.provedores ?? [])], arg), arg]
  if (principal === '/model') return [byPrefix([...(ctx.papeis ?? []), ...(ctx.modelos ?? []), 'padrao'], arg), arg]
  if (principal === '/effort') return [byPrefix([...(ctx.papeis ?? []), ...(ctx.esforcos ?? []), 'padrao'], arg), arg]
  if (principal === '/mode') return [byPrefix([...(ctx.papeis ?? []), ...(ctx.modos ?? []), 'padrao'], arg), arg]
  if (principal === '/ref') return [byPrefix([...PALAVRAS_DE_CLIPBOARD, 'ambiente'], arg), arg]
  if (principal === '/repo') return [byPrefix(ctx.repos, arg), arg]
  if (['/stop', '/rm'].includes(principal)) return [byPrefix(ctx.cards, arg), arg]
  return [[], arg]
}
