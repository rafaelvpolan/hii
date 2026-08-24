import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { STATUSES } from '../cdl/index.ts'
import { ROOT } from '../cdl/ali/config.ts'
import type { PipelineConfig, PipelineStep } from './tipos.ts'

interface ErroLido {
  message?: string
}

export const DEFAULT_STEPS: PipelineStep[] = [
  { id: 'arquitetura', label: 'Arquitetura', kind: 'quality', agent: 'rufus', state: 'REFINED', gate: 'none', enabled: true, gated: true, needs: [], instruction: 'Melhore a arquitetura/refatore o codigo relacionado a: "%s" sem mudar o comportamento observavel. Se nao houver ganho claro, nao mude nada.' },
  { id: 'testes', label: 'Testes', kind: 'quality', agent: 'testudo', state: 'TESTS_GREEN', gate: 'test', enabled: true, gated: true, needs: ['arquitetura'], instruction: 'Garanta cobertura de testes para: "%s". Escreva/ajuste testes se aplicavel ao projeto.' },
  { id: 'seguranca', label: 'Seguranca', kind: 'security', agent: 'escudo', state: 'SEC_CLEARED', gate: 'none', enabled: true, gated: true, needs: ['arquitetura'], instruction: 'Revise seguranca (OWASP, secrets, XSS, deps) do que foi alterado para: "%s". Corrija problemas criticos.' },
  { id: 'review', label: 'Review', kind: 'review', agent: 'crivo', state: 'REVIEWED', gate: 'none', enabled: true, needs: ['testes', 'seguranca'], instruction: 'Revise adversarialmente (read-only) o diff atual vs a tarefa "%s". Aponte problemas; nao edite arquivos.' },
  { id: 'limpeza', label: 'Limpeza', kind: 'cleanup', agent: 'pura', state: 'CLEANED', gate: 'none', enabled: true, needs: ['review'], instruction: 'Remova comentarios de prosa do codigo alterado (preserve licenca, diretivas de tooling, TODO/ticket).' },
]

function isValidStep(s: PipelineStep): boolean {
  return !!(s && s.id && s.label && s.agent && s.state && (STATUSES as readonly string[]).includes(s.state))
}

export function loadPipeline(worktree?: string): PipelineConfig {
  const candidates = worktree
    ? [join(worktree, '.hii', 'pipeline.json'), join(ROOT, 'config', 'pipeline.json')]
    : [join(ROOT, 'config', 'pipeline.json')]
  for (const f of candidates) {
    if (!existsSync(f)) continue
    try {
      const raw = JSON.parse(readFileSync(f, 'utf8')) as Partial<PipelineConfig>
      if (!Array.isArray(raw.steps)) continue
      const validos = raw.steps.filter(isValidStep)
      const invalidos = raw.steps.length - validos.length
      if (!validos.length) {
        process.stderr.write(`[hicode] ${f}: nenhum step valido (${raw.steps.length} reprovado(s)) — caindo para o proximo pipeline, nao para um pipeline VAZIO\n`)
        continue
      }
      if (invalidos) {
        process.stderr.write(`[hicode] ${f}: ${invalidos} step(s) invalido(s) ignorado(s) — o pipeline vai rodar SEM eles\n`)
      }
      return { version: Number(raw.version) || 1, steps: validos }
    } catch (e) {
      process.stderr.write(`[hicode] ${f} ilegivel (${(e as ErroLido).message ?? 'json invalido'}) — usando o pipeline padrao\n`)
      continue
    }
  }
  return { version: 1, steps: DEFAULT_STEPS }
}

export function activeSteps(worktree?: string): PipelineStep[] {
  return loadPipeline(worktree).steps.filter(s => s.enabled !== false)
}
