import { existsSync, readFileSync } from 'node:fs'
import { readCard } from '../cordel/store.ts'
import { etagDe } from '../cordel/revisao.ts'
import { lerPlano } from '../oswaldo/orquestracao/planos.ts'
import { arquivoDeEvidencias, fingerprintDoTrabalho, ocultarSegredos } from '../oswaldo/orquestracao/evidencias.ts'
import type { RelatorioDeEvidencias } from '../oswaldo/orquestracao/evidencias.ts'
import type { RevisaoDePlano } from '../oswaldo/orquestracao/planos.ts'
import type { AvaliacaoDeExecucao } from './avaliacao-contrato.ts'
import { lerEntrega, conferirEntrega } from '../oswaldo/orquestracao/entrega.ts'
import { relatorioConsistente } from '../oswaldo/orquestracao/validacao-evidencias.ts'
import { run } from '../quilombo/git.ts'
import { ErroApi } from './contrato.ts'

export async function avaliarExecucao(id: string, executar: typeof run = run): Promise<AvaliacaoDeExecucao> {
  const card = readCard(id)
  if (!card) throw new ErroApi(404, 'tarefa_ausente', 'tarefa nao encontrada')
  const etag = etagDe(card)
  const a: AvaliacaoDeExecucao = { versao: 1, execucao: id, repo: card.fm.repo || '', sessao: card.fm.sessao_id || '',
    status: card.fm.status || '', modo: card.fm.motor_modo || '', plano: null, atualidade: 'ausente',
    motivo: 'Execucao sem plano fixado; estado terminal nao comprova criterios.',
    consultadaEm: new Date().toISOString(), evidenciaEm: null, tentativa: null, criteriosAprovados: false, criterios: [] }
  const rev = Number(card.fm.plano_revisao)
  if (!Number.isSafeInteger(rev) || rev <= 0) return a
  let p: RevisaoDePlano | null
  try { p = lerPlano(a.repo, id, rev) }
  catch { return { ...a, atualidade: 'inconsistente', motivo: 'Historico do plano inconsistente.' } }
  if (!p || p.hash !== card.fm.plano_hash || p.plano.sessaoId !== (a.sessao || id)) return { ...a, atualidade: 'inconsistente', motivo: 'Revisao, hash ou sessao do plano diverge do card.' }
  const origem = p.plano.origemTecnica
  a.plano = { revisao: p.revisao, hash: p.hash, produto: p.plano.produtoId || '', planejamento: origem?.planejamento || '',
    origemRevisao: origem?.revisao || 0, tecnicoHash: origem?.sha256 || '' }
  a.criterios = p.plano.criterios.map(c => ({ id: c.id, descricao: c.descricao, obrigatorio: c.obrigatorio,
    estado: 'inconclusivo', resultadoRegistrado: null, comando: [], exitCode: null, timeout: false, duracaoMs: null, saida: 'Verificacao ainda nao registrada.' }))
  const arquivo = arquivoDeEvidencias(id, rev)
  const arquivada = !!card.fm.entrega_evidencia && ['PR_OPEN', 'MERGED', 'DEPLOYED'].includes(a.status)
  if (!arquivada && !existsSync(arquivo)) return { ...a, motivo: 'Nenhuma evidencia registrada para a revisao fixada.' }
  let fonte = ''
  let entrega: ReturnType<typeof lerEntrega> | null = null
  let r: RelatorioDeEvidencias
  try {
    if (arquivada) {
      entrega = lerEntrega(card.fm, p)
      r = entrega.relatorio
    } else {
      fonte = readFileSync(arquivo, 'utf8')
      r = JSON.parse(fonte) as RelatorioDeEvidencias
    }
    if (!relatorioConsistente(r, p)) throw new Error('relatorio inconsistente')
  } catch { return { ...a, atualidade: 'inconsistente', motivo: 'Relatorio incompleto ou divergente dos criterios do plano.' } }
  a.evidenciaEm = r.instante || null
  a.tentativa = r.tentativa || null
  a.criterios = a.criterios.map(c => {
    const e = r.evidencias.find(e => e.criterio === c.id)!
    return { ...c, resultadoRegistrado: e.estado, comando: e.comando, exitCode: e.exitCode, timeout: e.timeout,
      duracaoMs: e.duracaoMs, saida: ocultarSegredos(e.saida).slice(-32000) }
  })
  if (entrega) {
    try {
      a.entrega = await conferirEntrega(entrega, a.status, executar)
      const atual = readCard(id)
      if (!atual || etagDe(atual) !== etag || JSON.stringify(lerEntrega(atual.fm, p)) !== JSON.stringify(entrega)) {
        return { ...a, entrega: undefined, atualidade: 'desatualizada', motivo: 'Card ou certificado mudou durante a consulta.' }
      }
    } catch {
      return { ...a, entrega: undefined, atualidade: 'indisponivel', motivo: 'Entrega remota indisponivel ou divergente do commit validado; evidencia historica nao aprova.' }
    }
  } else {
    if (!card.fm.worktree || !existsSync(card.fm.worktree)) return { ...a, atualidade: 'indisponivel', motivo: 'Worktree indisponivel; evidencia historica nao confirma o trabalho atual.' }
    try {
      const antes = await fingerprintDoTrabalho(card.fm.worktree)
      const depois = await fingerprintDoTrabalho(card.fm.worktree)
      const atual = readCard(id)
      if (antes !== r.fingerprint || depois !== antes || !atual || etagDe(atual) !== etag || readFileSync(arquivo, 'utf8') !== fonte) {
        return { ...a, atualidade: 'desatualizada', motivo: 'Trabalho, card ou evidencia mudou; consulte novamente apos nova verificacao.' }
      }
    } catch { return { ...a, atualidade: 'indisponivel', motivo: 'Nao foi possivel conferir o Git; nenhum criterio foi promovido a aprovado.' } }
  }
  a.atualidade = 'atual'
  a.motivo = a.entrega ? 'Evidencias conferidas contra o commit do PR e, quando integrado, a arvore do merge no instante da consulta.' : 'Evidencias conferidas contra a revisao fixada e o trabalho no instante da consulta.'
  a.criterios = a.criterios.map(c => ({ ...c, estado: c.resultadoRegistrado! }))
  const obrigatorios = a.criterios.filter(c => c.obrigatorio)
  a.criteriosAprovados = a.modo === 'passivo' && obrigatorios.length > 0 && obrigatorios.every(c => c.estado === 'aprovado')
  return a
}
