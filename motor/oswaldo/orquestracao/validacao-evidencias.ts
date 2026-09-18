import type { RelatorioDeEvidencias } from './evidencias.ts'
import type { RevisaoDePlano } from './planos.ts'
import { ocultarSegredos } from './evidencias.ts'

export function relatorioConsistente(r: RelatorioDeEvidencias, p: RevisaoDePlano): boolean {
  if (!r || r.microtask !== undefined || typeof r.instante !== 'string' || !Number.isFinite(Date.parse(r.instante)) || r.versao !== 1 || r.plano !== p.plano.id || r.revisao !== p.revisao ||
    !/^[a-f0-9]{64}$/.test(r.fingerprint) || !Array.isArray(r.evidencias) ||
    r.evidencias.length !== p.plano.criterios.length || new Set(r.evidencias.map(e => e?.criterio)).size !== r.evidencias.length) return false
  return p.plano.criterios.every(c => {
    const e = r.evidencias.find(e => e?.criterio === c.id)
    if (!e || e.obrigatorio !== c.obrigatorio || !['aprovado', 'reprovado', 'inconclusivo', 'nao-aplicavel'].includes(e.estado) ||
      !Array.isArray(e.comando) || !e.comando.every(a => typeof a === 'string') || typeof e.saida !== 'string' ||
      (e.exitCode !== null && !Number.isSafeInteger(e.exitCode)) || typeof e.timeout !== 'boolean' || !Number.isFinite(e.duracaoMs) || e.duracaoMs < 0) return false
    if (e.estado === 'nao-aplicavel') return !c.obrigatorio && !!c.naoAplicavel
    if (e.estado === 'aprovado') return !!c.comando && e.exitCode === 0 && !e.timeout &&
      JSON.stringify(e.comando) === JSON.stringify([c.comando.binario, ...c.comando.argumentos].map(ocultarSegredos))
    return true
  })
}
