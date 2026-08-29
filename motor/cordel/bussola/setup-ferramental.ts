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

// Area nova = TODO arquivo do diff foi criado. Card que toca codigo existente nao
// paga o pedagio de setup, senao todo trabalho num repo legado travaria aqui para
// sempre.
//
// A versao anterior recebia uma lista so e devolvia `arquivos.length > 0` — ou
// seja "qualquer diff e area nova", o que nao e a definicao escrita no proprio
// comentario dela. E nao tinha consumidor: fechar.ts repetia a regra inline. Uma
// funcao nomeada com a regra ERRADA ao lado da regra certa inline e pior que nao
// ter a funcao: o proximo chamador acredita no nome.
export function ehAreaNova(alterados: readonly string[], criados: readonly string[]): boolean {
  if (!alterados.length) return false
  return criados.length === alterados.length
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
