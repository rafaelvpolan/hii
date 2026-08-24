import { COMMANDS, canonico } from './sessao.ts'
import { PALAVRAS_DE_CLIPBOARD } from './refs-comando.ts'

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
    // MAIORIA ESTRITA do hii continua valendo: `hii.length - 1` comandos da ia,
    // para o que o harness expoe nao afogar os comandos do proprio motor. Essa
    // parte e politica, e fica.
    //
    // O que sai e o teto ARBITRARIO de 6 no caso em que a ia aparece SOZINHA (sem
    // match do hii): ali nao havia maioria a proteger, e o corte fazia o "e mais N"
    // contar um resto que a navegacao nunca alcancava, porque o dado ja chegava
    // truncado no renderizador. Quem decide quantos CABEM na tela e quem desenha,
    // com janela em volta da selecao.
    const teto = hii.length ? Math.max(0, hii.length - 1) : daIa.length
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
