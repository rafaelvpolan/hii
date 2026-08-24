import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Contract } from './tipos.ts'

// BSS — Pilar 3: ferramenta de teste e de debug existem no momento em que a
// area nasce, nao depois. Checavel em disco, como todo gate deste motor:
// existe comando de teste no contrato? existe ponto de entrada de debug?
//
// Vale so para area NOVA. Ajuste em codigo existente nao paga esse pedagio —
// senao todo card num repo legado travaria na Fase 1 para sempre.

export interface FaltaDeSetup {
  readonly o_que: string
  readonly como_resolver: string
}

export interface VeredictoDeSetup {
  readonly pronto: boolean
  readonly faltas: readonly FaltaDeSetup[]
  // Falta de teste e checavel e objetiva: ou ha comando no contrato ou nao ha.
  // Falta de documento de debug e julgamento — vira nota, nunca barreira.
  readonly semTeste: boolean
}

const MARCAS_DE_DEBUG = ['.vscode/launch.json', 'DEBUG.md', 'docs/DEBUG.md', '.hii/debug.md']

export function ehAreaNova(arquivos: readonly string[]): boolean {
  // Area nova = tudo no diff e arquivo criado sob um diretorio que so tem
  // arquivo criado. Aqui recebemos so a lista; quem sabe o que e novo e o
  // chamador, entao a heuristica e conservadora: diff vazio nao e area nova.
  return arquivos.length > 0
}

export function conferirSetup(raiz: string, contrato: Pick<Contract, 'commands'>): VeredictoDeSetup {
  const faltas: FaltaDeSetup[] = []
  const temTeste = !!(contrato.commands?.test ?? '').trim()
  if (!temTeste) {
    faltas.push({
      o_que: 'nenhum comando de teste no contrato do alvo',
      como_resolver: 'declare o script de teste no package.json (ou equivalente) e rode `hii contract` para o motor enxergar',
    })
  }
  const temDebug = MARCAS_DE_DEBUG.some(m => existsSync(join(raiz, m)))
  if (!temDebug) {
    faltas.push({
      o_que: 'nenhum ponto de entrada de debug documentado',
      como_resolver: `crie um destes: ${MARCAS_DE_DEBUG.join(', ')}`,
    })
  }
  return { pronto: faltas.length === 0, faltas, semTeste: !temTeste }
}

export function relatoDoSetup(v: VeredictoDeSetup): string {
  if (v.pronto) return 'setup ferramental pronto: teste e debug configurados'
  return `setup ferramental incompleto — ${v.faltas.map(f => `${f.o_que} (${f.como_resolver})`).join(' · ')}`
}
