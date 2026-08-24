import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../cdl/ali/config.ts'
import { memoArquivo } from './eco/memo.ts'
import { avisarArquivoIlegivel, motivoDoErro } from '../cdl/ali/aviso.ts'
import type { AgentRole } from './tipos.ts'

export const ESFORCOS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Esforco = (typeof ESFORCOS)[number]

export const ESFORCO_PADRAO = '(padrao da IA)'

export interface PreferenciaDePapel {
  provider?: string
  model?: string
  effort?: string
  modo?: string
  // Interruptor do modo GAUNTLET do crivo (papel `gate`). Fica DESLIGADO por
  // omissao de proposito: o gauntlet julga por comparacao cega de telas e nao le
  // o diff, entao ligado por heuristica ele SUBSTITUIA o criterio escrito sem
  // ninguem pedir — e num card de pack visual com referencia anexada nenhuma
  // revisao automatica lia o codigo. Agora e escolha explicita, visivel na linha
  // de propriedades da TUI junto com as ias selecionadas.
  gauntlet?: boolean
}

export type PreferenciasDeIa = Partial<Record<AgentRole, PreferenciaDePapel>>

export function arquivoDePreferencias(): string {
  return process.env.HICODE_IA_FILE || join(ROOT, 'config', 'ia.json')
}

export function ehEsforco(valor: string | undefined): valor is Esforco {
  return !!valor && (ESFORCOS as readonly string[]).includes(valor)
}

// Arquivo AUSENTE e arquivo CORROMPIDO nao sao a mesma coisa. Ausente e o estado
// inicial normal — preferencia vazia e a resposta certa. Corrompido significa que
// o operador escolheu provedor, modelo e esforco e o motor vai gastar token em
// OUTRA coisa sem avisar. Truncamento deste arquivo e incidente atestado neste
// repo (por isso a gravacao virou atomica em escolher-ia.ts), entao o caso e real.
//
// Nao lanca: derrubar a TUI e o daemon por causa de um arquivo de preferencia
// seria pior. O aviso vem de motor/cdl/ali/aviso.ts — o warn-once vivia duplicado
// aqui, com Set e reset proprios e sem o token "ILEGIVEL" que os testes usam para
// reconhecer o aviso: duas fontes de verdade para a mesma regra.
const CONSEQUENCIA = 'as preferencias de ia NAO foram aplicadas; o motor vai usar o padrao/env. Conserte o arquivo ou apague-o para recomecar'
function lerDoDisco(caminho: string): PreferenciasDeIa {
  if (!existsSync(caminho)) return {}
  let cru: PreferenciasDeIa | null = null
  try {
    cru = JSON.parse(readFileSync(caminho, 'utf8')) as PreferenciasDeIa | null
  } catch (e) {
    avisarArquivoIlegivel(caminho, motivoDoErro(e as Error), CONSEQUENCIA)
    return {}
  }
  if (!cru || typeof cru !== 'object' || Array.isArray(cru)) {
    avisarArquivoIlegivel(caminho, 'o conteudo nao e um objeto de papeis', CONSEQUENCIA)
    return {}
  }
  return cru
}

const lerMemorizado = memoArquivo(caminho => caminho, lerDoDisco)

export function preferencias(): PreferenciasDeIa {
  return lerMemorizado(arquivoDePreferencias())
}

export function preferenciaDoPapel(role: AgentRole): PreferenciaDePapel {
  return preferencias()[role] ?? {}
}

// O gauntlet e um modo do papel `gate` — o crivo. Ler de um papel so evita um
// segundo arquivo de configuracao para um unico booleano.
export function gauntletLigado(): boolean {
  return preferenciaDoPapel('gate').gauntlet === true
}

export function esforcoPara(role: AgentRole, doCard?: string): Esforco | undefined {
  const candidatos = [doCard, preferenciaDoPapel(role).effort, process.env.HICODE_EFFORT]
  for (const c of candidatos) if (ehEsforco(c)) return c
  return undefined
}
