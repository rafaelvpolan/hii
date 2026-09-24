import { existsSync, mkdirSync, lstatSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { cardsDir, fallbackRemotoLigado, MAX_CONCURRENCY, quotaFallbackLigado } from '../../cordel/alicerce/config.ts'
import { despachoLiberado } from '../../euclides/tesouro/teto-global.ts'
import { readCard, patchCard } from '../../cordel/store.ts'
import type { Card, ImplementResult } from '../../cordel/tipos.ts'
import { isoNow } from '../../cordel/util.ts'
import { runGit, stageAll, withGitLock } from '../../quilombo/git.ts'
import { tetoDeParalelismo } from '../../quilombo/limites.ts'
import { reservarSlotsMicrotasks } from '../mutirao/estado-da-fila.ts'
import { iniciar, atualizar, terminar, dentro, recurso } from '../../observabilidade/registro.ts'
import { configDoOrquestrador } from './config.ts'
import { coletarEvidencias, fingerprintDoTrabalho } from './evidencias.ts'
import { pedidoDaMicrotask } from './checkpoint.ts'
import type { Checkpoint, Ramo, Implementar } from './checkpoint.ts'
import type { Microtask, PlanoDeExecucao } from './contrato.ts'
import { harnessSeExistir } from '../../tomada/registro.ts'
import { decidirRota } from '../../tomada/rota.ts'
import type { EntradaDeRota, DecisaoDeRota } from '../../tomada/rota.ts'

const recusa = (motivo: string): ImplementResult => ({ ok: false, reason: motivo, failureClass: 'terminal', failureReason: motivo, cost: '0', costMeasured: true })
async function git(wt: string, args: string[]): Promise<string> {
  const r = await runGit(wt, args)
  if (r.err) throw new Error('Git da microtask: ' + r.err.message)
  return r.stdout.trim()
}
async function limpo(wt: string): Promise<boolean> {
  return !(await git(wt, ['status', '--porcelain', '--untracked-files=all']))
}
const opcoesCommit = ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false']
async function commit(wt: string, mensagem: string): Promise<string> {
  const stage = await stageAll(wt)
  if (stage.err) throw stage.err
  await git(wt, [...opcoesCommit, 'commit', '--allow-empty', '-m', mensagem])
  return git(wt, ['rev-parse', 'HEAD'])
}
function independentes(onda: Microtask[]): boolean {
  const nomes: string[] = []
  for (const m of onda) {
    if (!m.arquivos.length) return false
    for (const nome of m.arquivos) {
      // Escopo amplo ou infraestrutura compartilhada permanece serial.
      if (!/^[a-zA-Z0-9_./-]+$/.test(nome) || nome.split('/').some(p => !p || p === '.' || p === '..') ||
        /(^|\/)(migrations?|contracts?|schema)(\/|\.)|(^|\/)(package\.json|.*lock.*|tsconfig.*|Cargo\.toml|go\.mod)$/i.test(nome)) return false
      if (nomes.some(n => n === nome || n.startsWith(nome + '/') || nome.startsWith(n + '/'))) return false
      nomes.push(nome)
    }
  }
  return true
}
async function conferirWorktree(card: Card, wt: string): Promise<void> {
  if (!card.fm.worktree || realpathSync(card.fm.worktree) !== realpathSync(wt) || !card.fm.branch) throw new Error('paralelismo exige worktree e branch da execucao')
  if (await git(wt, ['branch', '--show-current']) !== card.fm.branch) throw new Error('branch da execucao divergiu')
  const comum = resolve(wt, await git(wt, ['rev-parse', '--git-common-dir']))
  const proprio = resolve(wt, await git(wt, ['rev-parse', '--git-dir']))
  if (comum === proprio) throw new Error('paralelismo nao pode usar o clone principal')
}
async function conferirRamo(wt: string, ramo: Ramo): Promise<void> {
  const esperado = resolve(cardsDir(), 'orquestracao', 'worktrees')
  if (!resolve(ramo.worktree).startsWith(esperado + '/')) throw new Error('worktree do ramo fora da raiz de execucao')
  if (!existsSync(ramo.worktree) || lstatSync(ramo.worktree).isSymbolicLink()) throw new Error('worktree do ramo ausente ou substituido')
  const comum = await git(wt, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  if (await git(ramo.worktree, ['rev-parse', '--path-format=absolute', '--git-common-dir']) !== comum) throw new Error('ramo pertence a outro repositorio')
  if (ramo.commit && await git(ramo.worktree, ['rev-parse', 'HEAD']) !== ramo.commit) throw new Error('HEAD do ramo mudou')
  if (ramo.fingerprint && await fingerprintDoTrabalho(ramo.worktree) !== ramo.fingerprint) throw new Error('trabalho do ramo mudou')
}
async function mergeReconhecido(wt: string, ramo: Ramo): Promise<boolean> {
  const head = await git(wt, ['rev-parse', 'HEAD'])
  if (head === ramo.antesIntegrar) return false
  const partes = (await git(wt, ['rev-list', '--parents', '-1', 'HEAD'])).split(' ')
  if (partes.length !== 3 || partes[1] !== ramo.antesIntegrar || partes[2] !== ramo.commit || !await limpo(wt)) throw new Error('integracao incerta: HEAD nao corresponde ao merge reservado')
  ramo.integradoHead = head
  ramo.estado = 'integrado'
  return true
}
export async function reconciliarIntegracaoParalela(wt: string, c: Checkpoint, salvar: () => void): Promise<void> {
  const onda = c.paralela
  if (!onda || onda.estado === 'concluida') return
  if (onda.versao !== 1 || !Array.isArray(onda.ramos) || onda.ramos.length > 4) throw new Error('diario paralelo incompativel')
  if (onda.estado === 'preparando') throw new Error('preparacao paralela interrompida; reconcilie o checkpoint Git antes de retomar')
  for (const ramo of onda.ramos) {
    if (ramo.estado !== 'integrando') continue
    await conferirRamo(wt, ramo)
    if (await mergeReconhecido(wt, ramo)) {
      c.fingerprint = await fingerprintDoTrabalho(wt)
      salvar()
    }
  }
}
interface Contexto {
  card: Card; wt: string; plano: PlanoDeExecucao; revisao: number; checkpoint: Checkpoint
  onda: Microtask[]; orcamentoDisponivelUsd: number; salvar: () => void; implementar: Implementar; visual: boolean
  rota?: (entrada: EntradaDeRota) => DecisaoDeRota
}
export async function executarOndaParalela(ctx: Contexto): Promise<ImplementResult | null> {
  const { card, wt, plano, revisao, checkpoint: c, salvar, implementar, visual } = ctx
  const id = card.fm.id!
  const tarefas = ctx.onda.filter(m => !c.feitas.includes(m.id))
  const existente = c.paralela?.estado === 'ativa' && c.paralela.tarefas.some(t => tarefas.some(m => m.id === t)) ? c.paralela : undefined
  const limite = configDoOrquestrador(plano.repo).concorrenciaMicrotasks ?? 1
  if (!existente && (tarefas.length < 2 || tarefas.length > limite || !independentes(tarefas))) return null
  const reserva = reservarSlotsMicrotasks(id, existente ? 1 : tarefas.length, tetoDeParalelismo(MAX_CONCURRENCY))
  if (!reserva) return existente ? recusa('aguardando slots para reconciliar ramos paralelos') : null
  let custo = 0, medido = true
  const usage = { tokens_in: 0, tokens_out: 0, tokens_cache_create: 0, tokens_cache_read: 0 }
  const ativo = () => readCard(id)?.fm.status === 'EXECUTING'
  try {
    await conferirWorktree(readCard(id) ?? card, wt)
    if (!existente) {
      if (!ativo()) return recusa('execucao interrompida')
      const global = despachoLiberado()
      if (!global.pode) return recusa(global.motivo)
      if (!Number.isFinite(ctx.orcamentoDisponivelUsd) || ctx.orcamentoDisponivelUsd <= 0) return recusa('orcamento indisponivel para reservar ramos')
      if (c.paralela?.estado === 'concluida') (c.ondasConcluidas ??= []).push(c.paralela)
      c.paralela = { versao: 1, tarefas: tarefas.map(m => m.id), estado: 'preparando', base: '', ramos: [] }
      salvar()
      // O commit guarda a predecessora que editou sem commit. Nenhum push acontece aqui.
      const base = await commit(wt, 'hii: checkpoint anterior a onda ' + tarefas.map(m => m.id).join(','))
      const pasta = join(cardsDir(), 'orquestracao', 'worktrees')
      mkdirSync(pasta, { recursive: true })
      c.paralela.base = base
      c.paralela.ramos = tarefas.map(m => ({
        microtask: m.id, worktree: join(pasta, id + '-' + revisao + '-' + c.hash.slice(0, 12) + '-' + m.id),
        base, orcamentoReservadoUsd: ctx.orcamentoDisponivelUsd / tarefas.length, estado: 'reservado', tentativa: { microtask: m.id, inicio: '', fim: '', provedor: m.ia?.provedor ?? '', modelo: m.ia?.modelo ?? '', estado: 'executando', custo: '', motivo: '' }, tentativas: [],
      }))
      c.paralela.estado = 'ativa'
      c.fingerprint = await fingerprintDoTrabalho(wt)
      salvar()
    }
    const onda = c.paralela!
    if (onda.ramos.some(r => r.estado === 'executando' || r.estado === 'bloqueado')) return { ...recusa('ramo interrompido ou bloqueado; reconcilie efeitos e custos antes de retomar'), costMeasured: false }
    // Criacao serial sob o lock Git existente; chamadas acontecem somente depois.
    for (const ramo of onda.ramos) {
      if (ramo.estado !== 'reservado') continue
      if (existsSync(ramo.worktree)) throw new Error('diretorio de ramo reservado ja existe; reconciliacao necessaria')
      await withGitLock(() => git(wt, ['worktree', 'add', '--detach', ramo.worktree, ramo.base]))
    }
    patchCard(id, { microtask_atual: onda.tarefas.join(',') }, isoNow() + ' onda paralela: ' + onda.tarefas.join(', ') + '; worktrees isolados, integracao pendente')
    const novas = onda.ramos.filter(r => r.estado === 'reservado')
    // Na retomada, nunca despachar ramos novos com uma reserva de reconciliacao.
    if (existente && novas.length) return recusa('onda interrompida antes do despacho; revise os ramos reservados')
    const encerradas = await Promise.allSettled(novas.map(async ramo => {
      const m = tarefas.find(m => m.id === ramo.microtask)!
      if (!ativo()) return
      ramo.estado = 'executando'
      ramo.tentativa.inicio = isoNow()
      salvar()
      const atividade = iniciar({ repo: plano.repo, sessao: plano.sessaoId, execucao: id }, recurso(m.agente, 'agent'), { papel: 'microtask', isolamento: 'git-worktree', worktree: ramo.worktree })
      atualizar(atividade, a => { a.microtask = m.id; a.planoRevisao = revisao })
      try {
        let override: string | undefined
        const tentados: string[] = []
        let gastoDoRamo = 0
        let resposta: ImplementResult
        for (;;) {
          const pedido = pedidoDaMicrotask({ ...card, fm: { ...card.fm, orq_ramo: 'true', ...(override ? { provider_override_implement: override } : {}) } }, plano, m)
          const tentativa = ramo.tentativa
          tentativa.inicio ||= isoNow()
          resposta = await dentro(atividade, () => implementar(pedido, ramo.worktree, '', visual))
          ramo.resultado = resposta
          tentativa.custo = resposta.cost
          tentativa.custoMedido = resposta.costMeasured === true && Number.isFinite(Number(resposta.cost)) && Number(resposta.cost) >= 0
          tentativa.provedor = resposta.provider ?? override ?? tentativa.provedor
          tentativa.modelo = resposta.model ?? tentativa.modelo
          tentativa.fim = isoNow()
          tentativa.motivo = resposta.reason ?? ''
          tentativa.estado = resposta.ok ? 'concluida' : 'falhou'
          const valor = Number(resposta.cost)
          if (Number.isFinite(valor) && valor >= 0) { custo += valor; gastoDoRamo += valor }
          medido &&= tentativa.custoMedido
          for (const k of Object.keys(usage) as (keyof typeof usage)[]) usage[k] += resposta.usage?.[k] ?? 0
          if (resposta.ok) break
          const atual = resposta.provider ?? override ?? ''
          if (atual) tentados.push(atual)
          const localFalhou = resposta.failureClass === 'transient' && harnessSeExistir(atual)?.rodaLocal === true
          const elegivel = !m.ia && tentativa.custoMedido && await limpo(ramo.worktree) &&
            ((resposta.failureClass === 'quota' && quotaFallbackLigado()) || (localFalhou && fallbackRemotoLigado()))
          if (!elegivel || gastoDoRamo >= ramo.orcamentoReservadoUsd || !ativo()) break
          const rota = (ctx.rota ?? decidirRota)({ papel: 'implement', classeDeFalha: resposta.failureClass!, provedorAtual: atual, tentadosNestaRodada: tentados, localFalhou })
          if (rota.acao !== 'trocar' || tentados.includes(rota.para)) break
          ;(ramo.tentativas ??= []).push({ ...tentativa })
          override = rota.para
          ramo.tentativa = { microtask: m.id, inicio: isoNow(), fim: '', provedor: override, modelo: '', estado: 'executando', custo: '', motivo: '' }
          salvar()
        }
        if (!resposta.ok) throw new Error(resposta.reason || 'harness falhou')
        if (!ramo.tentativa.custoMedido) throw new Error('custo desconhecido no ramo')
        if (gastoDoRamo > ramo.orcamentoReservadoUsd) throw new Error('orcamento reservado excedido no ramo; nenhum novo despacho autorizado')
        if (!(await coletarEvidencias(plano, revisao, ramo.worktree, undefined, m.id)).aprovado) throw new Error('criterios do ramo reprovados ou inconclusivos')
        const alterados = [...(await git(ramo.worktree, ['diff', '--name-only', '-z', ramo.base])).split('\0'),
          ...(await git(ramo.worktree, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0')].filter(Boolean)
        if (alterados.some(f => !m.arquivos.includes(f))) throw new Error('ramo alterou arquivo fora do escopo independente')
        ramo.commit = await commit(ramo.worktree, 'hii: microtask ' + m.id)
        ramo.fingerprint = await fingerprintDoTrabalho(ramo.worktree)
        ramo.estado = 'pronto'
        ramo.tentativa.estado = 'concluida'
        terminar(atividade, 'succeeded', 'ramo verificado; integracao pendente')
      } catch (erro) {
        ramo.estado = 'bloqueado'
        ramo.motivo = (erro as Error).message
        ramo.tentativa.estado = ramo.resultado ? 'falhou' : 'interrompida'
        ramo.tentativa.motivo = ramo.motivo
        if (!ramo.resultado) medido = false
        terminar(atividade, 'failed', ramo.motivo)
      } finally {
        ramo.tentativa.fim = isoNow()
        salvar()
      }
    }))
    if (encerradas.some(r => r.status === 'rejected')) return { ...recusa('falha ao persistir ramo; todos os filhos encerraram, reconcilie o diario'), cost: String(custo), costMeasured: false, usage }
    if (!ativo()) return { ...recusa('execucao interrompida; ramos preservados'), cost: String(custo), costMeasured: medido, usage }
    const bloqueado = onda.ramos.find(r => r.estado === 'bloqueado' || r.estado === 'executando' || r.estado === 'reservado')
    if (bloqueado) return { ...recusa('microtask ' + bloqueado.microtask + ': ' + (bloqueado.motivo || 'resultado incerto')), cost: String(custo), costMeasured: medido, usage }
    if (!medido) return { ...recusa('custo desconhecido; integracao bloqueada'), cost: String(custo), costMeasured: false, usage }
    for (const ramo of onda.ramos) {
      if (!ativo()) return { ...recusa('execucao interrompida; integracao pendente'), cost: String(custo), costMeasured: medido, usage }
      await conferirRamo(wt, ramo)
      if (ramo.estado === 'integrado') continue
      if (await fingerprintDoTrabalho(wt) !== c.fingerprint || !await limpo(wt)) throw new Error('worktree principal mudou antes da integracao')
      if (ramo.estado === 'integrando' && await mergeReconhecido(wt, ramo)) { c.fingerprint = await fingerprintDoTrabalho(wt); salvar(); continue }
      ramo.antesIntegrar = await git(wt, ['rev-parse', 'HEAD'])
      ramo.estado = 'integrando'
      salvar()
      const merge = await withGitLock(() => runGit(wt, [...opcoesCommit, 'merge', '--no-ff', '--no-edit', ramo.commit!]))
      if (merge.err) throw new Error('integracao bloqueada para ' + ramo.microtask + '; ramos e conflito preservados: ' + merge.err.message)
      if (!await mergeReconhecido(wt, ramo)) throw new Error('merge sem resultado confirmado')
      c.fingerprint = await fingerprintDoTrabalho(wt)
      salvar()
    }
    // Prova do diff combinado, nunca reusar a prova do worktree filho.
    for (const ramo of onda.ramos) {
      if (!(await coletarEvidencias(plano, revisao, wt, undefined, ramo.microtask)).aprovado) throw new Error('criterios combinados falharam: ' + ramo.microtask)
    }
    if (!ativo()) return { ...recusa('execucao interrompida apos integracao'), cost: String(custo), costMeasured: medido, usage }
    for (const ramo of onda.ramos) {
      if (!c.feitas.includes(ramo.microtask)) { c.feitas.push(ramo.microtask); (c.tentativas ??= []).push(...(ramo.tentativas ?? []), ramo.tentativa) }
    }
    onda.estado = 'concluida'
    c.fingerprint = await fingerprintDoTrabalho(wt)
    salvar()
    return { ok: true, cost: String(custo), costMeasured: medido, usage }
  } catch (erro) {
    return { ...recusa((erro as Error).message), cost: String(custo), costMeasured: medido, usage }
  } finally { reserva() }
}
