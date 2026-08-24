import type { PapelDeSkill } from '../csd/acervo'

// OSW — orchestrator-workers DENTRO de uma fase, sem motor novo.
//
// O pipeline de card continua unico e sequencial nas fases macro. O que muda e
// que uma fase pode rodar mais de um especialista quando o diff pede — front e
// banco no mesmo card sao dois assuntos, e um agente generico faz os dois pior
// que dois especificos.
//
// Duas regras que este modulo existe para nao violar:
//
// QUEM DECIDE E CODIGO. `decidirEspecs` e funcao pura sobre o diff. "A IA decide
// se chama outro agente" trocaria uma escolha barata e reproduzivel por uma
// chamada de modelo que muda de opiniao entre execucoes — e por um caminho de
// escalada que ninguem auditou.
//
// PARALELO SO SEM SOBREPOSICAO. Dois agentes editando o mesmo arquivo ao mesmo
// tempo perdem trabalho um do outro em silencio. Conjunto de arquivos disjunto e
// a condicao, verificada aqui, nao prometida no prompt.

export const MAX_AGENTES_POR_FASE = 4

export interface EspecDeAgente {
  readonly agente: string
  readonly papel: PapelDeSkill
  readonly arquivos: readonly string[]
}

interface Especialidade {
  readonly agente: string
  readonly papel: PapelDeSkill
  readonly rx: RegExp
}

const ESPECIALIDADES: readonly Especialidade[] = [
  { agente: 'vitro', papel: 'implementador', rx: /\.(?:vue|tsx|jsx)$/i },
  { agente: 'radix', papel: 'implementador', rx: /(?:^|\/)migrations?\/|\.sql$|(?:^|\/)schema\./i },
  { agente: 'escudo', papel: 'seguranca', rx: /auth|payment|pagamento|credencial|\.env$/i },
  { agente: 'testudo', papel: 'avaliador', rx: /(?:^|\/)tests?\/|\.(?:test|spec)\.[a-z]+$/i },
]

export interface ContextoDeDespacho {
  readonly arquivos: readonly string[]
}

export function decidirEspecs(ctx: ContextoDeDespacho): EspecDeAgente[] {
  const porAgente = new Map<string, { papel: PapelDeSkill; arquivos: string[] }>()
  for (const arquivo of ctx.arquivos) {
    for (const e of ESPECIALIDADES) {
      if (!e.rx.test(arquivo)) continue
      const atual = porAgente.get(e.agente) ?? { papel: e.papel, arquivos: [] }
      atual.arquivos.push(arquivo)
      porAgente.set(e.agente, atual)
    }
  }
  return [...porAgente.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, MAX_AGENTES_POR_FASE)
    .map(([agente, v]) => ({ agente, papel: v.papel, arquivos: v.arquivos }))
}

function sobrepoe(a: readonly string[], b: readonly string[]): boolean {
  const conjunto = new Set(a)
  return b.some(x => conjunto.has(x))
}

export function lotesSemSobreposicao(specs: readonly EspecDeAgente[]): EspecDeAgente[][] {
  const lotes: EspecDeAgente[][] = []
  for (const spec of specs) {
    const lote = lotes.find(l => l.every(outro => !sobrepoe(outro.arquivos, spec.arquivos)))
    if (lote) lote.push(spec)
    else lotes.push([spec])
  }
  return lotes
}

export type ExecutorDeAgente<T> = (spec: EspecDeAgente) => Promise<T>

export async function despacharAgentesNaFase<T>(specs: readonly EspecDeAgente[], executar: ExecutorDeAgente<T>): Promise<T[]> {
  const fora: T[] = []
  for (const lote of lotesSemSobreposicao(specs)) {
    fora.push(...await Promise.all(lote.map(executar)))
  }
  return fora
}
