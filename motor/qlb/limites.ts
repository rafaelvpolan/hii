import { cpus, totalmem } from 'node:os'
import { numeroDeEnv } from '../cdl/ali/config.ts'

// QLB — teto de recurso por worktree paralelo.
//
// Limite REAL de cpu e memoria e do container, declarado em docker-stack.yml
// (`deploy.resources.limits`, honrado pelo swarm) ou pelo equivalente de cada nuvem. Um processo Node
// nao consegue se autolimitar de verdade, e prometer isso em codigo seria
// garantia falsa.
//
// O que o motor PODE fazer, e faz aqui: limitar CONCORRENCIA. Dado um orcamento
// por worktree, quantos cabem no que o container recebeu. Sem isso, um card com
// laco de reparo preso consome o host e derruba os outros — mesmo motivo do
// orcamentoPorCard, um em recurso de maquina e outro em custo de token.
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

export interface PermissaoDeWorktree {
  readonly pode: boolean
  readonly motivo: string
}

export function podeAbrirMaisUm(emVoo: number, o: OrcamentoDeRecurso = orcamentoDeRecurso()): PermissaoDeWorktree {
  const { cabem, limitante } = quantosWorktreesCabem(o)
  if (emVoo < cabem) return { pode: true, motivo: `${emVoo} em voo de ${cabem} que cabem` }
  return { pode: false, motivo: `teto de ${cabem} worktree(s) em paralelo atingido (${limitante} e o limitante) — o proximo card espera` }
}

export function relatoDeLimites(o: OrcamentoDeRecurso = orcamentoDeRecurso()): string {
  const c = quantosWorktreesCabem(o)
  return [
    `recurso: ${c.cabem} worktree(s) em paralelo — ${c.motivo}`,
    `orcamento por worktree: ${o.memoriaPorWorktreeMb}MB e ${o.cpuPorWorktree} cpu (HICODE_MEM_POR_WORKTREE_MB, HICODE_CPU_POR_WORKTREE)`,
    'o teto de fato e do container: declare em docker-stack.yml (deploy.resources.limits, honrado pelo docker swarm) — o processo so limita concorrencia',
  ].join('\n')
}
