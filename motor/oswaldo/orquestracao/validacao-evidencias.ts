import type { RelatorioDeEvidencias } from './evidencias.ts'
import type { RevisaoDePlano } from './planos.ts'
import { ocultarSegredos } from './evidencias.ts'

export function relatorioConsistente(r: RelatorioDeEvidencias, p: RevisaoDePlano): boolean {
  if (!r || r.microtask !== undefined || typeof r.instante !== 'string' || !Number.isFinite(Date.parse(r.instante)) || r.versao !== 1 || r.plano !== p.plano.id || r.revisao !== p.revisao ||
    !/^[a-f0-9]{64}$/.test(r.fingerprint) || !Array.isArray(r.evidencias) ||
    r.evidencias.length !== p.plano.criterios.length || new Set(r.evidencias.map(e => e?.criterio)).size !== r.evidencias.length) return false
  if (r.aprovado !== r.evidencias.every(e => !e.obrigatorio || e.estado === 'aprovado')) return false
  return p.plano.criterios.every(c => {
    const e = r.evidencias.find(e => e?.criterio === c.id)
    if (!e || e.obrigatorio !== c.obrigatorio || !['aprovado', 'reprovado', 'inconclusivo', 'nao-aplicavel'].includes(e.estado) ||
      !Array.isArray(e.comando) || !e.comando.every(a => typeof a === 'string') || typeof e.saida !== 'string' ||
      (e.exitCode !== null && !Number.isSafeInteger(e.exitCode)) || typeof e.timeout !== 'boolean' ||
      ![null, 'codigo-saida', 'timeout', 'sinal', 'ferramenta-ausente', 'ambiente', 'evidencia-ausente', 'trabalho-alterado'].includes(e.falha) ||
      !Number.isFinite(e.duracaoMs) || e.duracaoMs < 0) return false
    if (e.estado === 'nao-aplicavel') return !c.obrigatorio && !!c.naoAplicavel && e.saida === c.naoAplicavel && e.falha === null && e.comando.length === 0
    if (e.estado === 'aprovado') return !!c.comando && e.exitCode === 0 && !e.timeout && e.falha === null && !e.sinal &&
      JSON.stringify(e.comando) === JSON.stringify([c.comando.binario, ...c.comando.argumentos].map(ocultarSegredos))
    if (e.falha === 'timeout') return e.timeout
    if (e.falha === 'sinal') return !!e.sinal && !e.timeout
    if (e.falha === 'codigo-saida') return e.estado === 'reprovado' && e.exitCode !== null && e.exitCode !== 0 && !e.timeout && !e.sinal
    if (e.falha === 'ferramenta-ausente' || e.falha === 'ambiente') return e.estado === 'inconclusivo' && e.exitCode === null && !e.timeout && !e.sinal
    if (e.falha === 'evidencia-ausente') return e.estado === 'inconclusivo' && !c.comando && !c.naoAplicavel
    return e.falha === 'trabalho-alterado' && e.estado === 'inconclusivo'
  })
}
