import { cpus, totalmem } from 'node:os'
import { numeroDeEnv } from '../cordel/alicerce/config.ts'

// Quilombo — teto de recurso por worktree paralelo.
//
// Limite REAL de cpu e memoria e do container, declarado em docker-stack.yml
// (`deploy.resources.limits`, honrado pelo swarm) ou pelo equivalente de cada nuvem. Um processo Node
// nao consegue se autolimitar de verdade, e prometer isso em codigo seria
// garantia falsa.
//
// O que o motor PODE fazer, e faz: limitar CONCORRENCIA. Dado um orcamento por
// worktree, quantos cabem no que o container recebeu. Sem isso, um card com laco
// de reparo preso consome o host e derruba os outros — mesmo motivo do
// orcamentoPorCard, um em recurso de maquina e outro em custo de token.
//
// "Faz" e afirmacao com endereco: `tetoDeParalelismo` (fim deste arquivo) e
// aplicado pelo escalonador em motor/oswaldo/mutirao/fila.ts. Enquanto esse elo nao
// existia, este comentario dizia "faz aqui" e o modulo nao tinha UM importador de
// producao: o escalonador usava so HICODE_CONCURRENCY e abria 3 worktrees de
// 2048MB contra um limite de 4096MB.
//
// Nunca devolve zero: um card por vez sempre cabe. Devolver zero pararia a fila
// para sempre sem dizer por que, que e a falha silenciosa que este motor recusa.

export interface OrcamentoDeRecurso {
  readonly totalMemoriaMb: number
  readonly memoriaPorWorktreeMb: number
  readonly totalCpus: number
  readonly cpuPorWorktree: number
}

export const MEMORIA_POR_WORKTREE_MB = 2048
export const CPU_POR_WORKTREE = 1

export function orcamentoDeRecurso(): OrcamentoDeRecurso {
  return {
    totalMemoriaMb: numeroDeEnv('HICODE_MEM_TOTAL_MB', Math.floor(totalmem() / (1024 * 1024))),
    memoriaPorWorktreeMb: numeroDeEnv('HICODE_MEM_POR_WORKTREE_MB', MEMORIA_POR_WORKTREE_MB),
    totalCpus: numeroDeEnv('HICODE_CPUS_TOTAL', cpus().length),
    cpuPorWorktree: numeroDeEnv('HICODE_CPU_POR_WORKTREE', CPU_POR_WORKTREE),
  }
}

export interface CabemQuantos {
  readonly cabem: number
  readonly limitante: string
  readonly motivo: string
}

export function quantosWorktreesCabem(o: OrcamentoDeRecurso): CabemQuantos {
  if (!(o.memoriaPorWorktreeMb > 0)) throw new Error('memoriaPorWorktreeMb precisa ser maior que zero — divisao por zero viraria paralelismo infinito')
  if (!(o.cpuPorWorktree > 0)) throw new Error('cpuPorWorktree precisa ser maior que zero — divisao por zero viraria paralelismo infinito')
  const porMemoria = Math.floor(o.totalMemoriaMb / o.memoriaPorWorktreeMb)
  const porCpu = Math.floor(o.totalCpus / o.cpuPorWorktree)
  const bruto = Math.min(porMemoria, porCpu)
  const limitante = porMemoria === porCpu ? 'memoria e cpu' : (porMemoria < porCpu ? 'memoria' : 'cpu')
  if (bruto < 1) {
    return {
      cabem: 1,
      limitante,
      motivo: `o que o container recebeu (${o.totalMemoriaMb}MB, ${o.totalCpus} cpu) e menor que o orcamento de um worktree (${o.memoriaPorWorktreeMb}MB, ${o.cpuPorWorktree} cpu) — segue com um card por vez, porque parar a fila em silencio seria pior`,
    }
  }
  return { cabem: bruto, limitante, motivo: `${bruto} worktree(s) cabem; ${limitante} e o recurso que limita` }
}

// `podeAbrirMaisUm` vivia aqui e nao tinha consumidor de producao. Pior: ela
// ignorava HICODE_CONCURRENCY, ou seja era uma SEGUNDA regra de paralelismo, mais
// fraca que a do escalonador — duas fontes de verdade para a mesma decisao, e a
// morta permitia mais do que a viva. Quem decide e `tetoDeParalelismo` (abaixo),
// aplicado em motor/oswaldo/mutirao/fila.ts.

export function relatoDeLimites(o: OrcamentoDeRecurso = orcamentoDeRecurso()): string {
  const c = quantosWorktreesCabem(o)
  return [
    `recurso: ${c.cabem} worktree(s) em paralelo — ${c.motivo}`,
    `orcamento por worktree: ${o.memoriaPorWorktreeMb}MB e ${o.cpuPorWorktree} cpu (HICODE_MEM_POR_WORKTREE_MB, HICODE_CPU_POR_WORKTREE)`,
    'o teto de fato e do container: declare em docker-stack.yml (deploy.resources.limits, honrado pelo docker swarm) — o processo so limita concorrencia',
  ].join('\n')
}

// O ponto onde o teto de recurso deixa de ser numero calculado e vira decisao de
// escalonamento. Enquanto este modulo nao tinha consumidor, `quantosWorktreesCabem`
// era um relatorio bonito que ninguem lia: o escalonador usava so HICODE_CONCURRENCY.
//
// O menor dos dois manda. O operador ainda pode BAIXAR por HICODE_CONCURRENCY, mas
// nao pode subir acima do que o container comporta — que era como 3 worktrees de
// 2048MB acabavam pedindo 6GB contra um limite de 4GB.
//
// Nunca devolve zero, pelo mesmo motivo de quantosWorktreesCabem: um card por vez
// sempre cabe, e parar a fila em silencio e pior que rodar devagar.
export function tetoDeParalelismo(maxConfigurado: number, o: OrcamentoDeRecurso = orcamentoDeRecurso()): number {
  const cabem = quantosWorktreesCabem(o).cabem
  return Math.max(1, Math.min(maxConfigurado, cabem))
}
