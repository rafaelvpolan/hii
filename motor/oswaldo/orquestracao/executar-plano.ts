import { runGit } from '../../quilombo/git.ts'
import { harnessPorNome } from '../../tomada/registro.ts'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { Card, ImplementResult } from '../../cordel/tipos.ts'
import { cardsDir } from '../../cordel/alicerce/config.ts'
import { patchCard, readCard, repoPath } from '../../cordel/store.ts'
import { isoNow } from '../../cordel/util.ts'
import { objetivoComInstrucoes } from '../../mirante/instruir.ts'
import { ensureContract } from '../../cordel/bussola/armazenar.ts'
import { resolveCommand } from '../../mirante/comandos.ts'
import { writeFileAtomic } from '../mutirao/trava-arquivo.ts'
import { ondasEstritas } from './contrato.ts'
import type { PlanoDeExecucao, CriterioDoPlano } from './contrato.ts'
import { lerPlano, salvarPlano } from './planos.ts'
import { fingerprintDoTrabalho, coletarEvidencias } from './evidencias.ts'
import { gastoDoCard, tetoDoCard } from '../../euclides/tesouro/orcamento.ts'
import { iniciar, atualizar, terminar, dentro, recurso } from '../../observabilidade/registro.ts'

export function planoInicial(card: Card, wt: string): PlanoDeExecucao {
  const contrato = ensureContract(repoPath(card.fm.repo ?? ''), isoNow())
  const criterios: CriterioDoPlano[] = []
  for (const kind of ['build', 'test', 'typecheck', 'lint'] as const) {
    const cmd = resolveCommand(contrato, kind, wt)
    if (!cmd) continue
    // Gerentes que dependem de env especifica continuam nos gates existentes.
    if (Object.keys(cmd.env).length) continue
    criterios.push({ id: kind, descricao: `${cmd.label} termina com exit=0`, obrigatorio: true,
      comando: { binario: cmd.cmd, argumentos: cmd.args, diretorio: relative(wt, cmd.cwd) || '.', timeoutMs: 240000 } })
  }
  if (!criterios.length) criterios.push({ id: 'validacao', descricao: 'Definir uma verificacao executavel para o objetivo', obrigatorio: true })
  const objetivo = objetivoComInstrucoes(card.body, card.fm.title ?? '')
  return { versao: 1, id: card.fm.id ?? '', repo: card.fm.repo ?? '', sessaoId: card.fm.sessao_id ?? card.fm.id ?? '', objetivo,
    risco: card.fm.risk === 'high' ? 'high' : 'low', criterios,
    microtasks: [{ id: 'implementacao', titulo: card.fm.title ?? objetivo, instrucao: objetivo, agente: 'limpio', dependeDe: [], arquivos: [], criterios: criterios.map(c => c.id) }],
    rollout: { ativacao: 'PR aprovado pelo humano; sem merge automatico', sucesso: 'criterios obrigatorios aprovados e review liberado', interrupcao: 'falha, evidencia inconclusiva ou parada humana', reversao: 'reverter a mudanca revisada; /stop interrompe a execucao' } }
}

interface Tentativa { microtask: string; inicio: string; fim: string; provedor: string; modelo: string; estado: 'executando' | 'concluida' | 'falhou' | 'interrompida'; custo: string; motivo: string }
interface Checkpoint { versao: 1; hash: string; feitas: string[]; fingerprint: string; tentativas?: Tentativa[] }

export async function executarPlano(card: Card, wt: string, implementar: (card: Card, wt: string, feedback: string, visual: boolean) => Promise<ImplementResult>, visual: boolean): Promise<ImplementResult> {
  const id = card.fm.id ?? ''
  const revisao = card.fm.plano_revisao ? Number(card.fm.plano_revisao) : undefined
  let r = lerPlano(card.fm.repo ?? '', id, revisao)
  if (!r && revisao !== undefined) throw new Error('revisao fixada do plano nao existe')
  r ??= salvarPlano(planoInicial(card, wt), 0, `inicial-${id}`)
  if (r.plano.sessaoId !== (card.fm.sessao_id || id)) throw new Error('plano pertence a outra session')
  for (const dep of r.plano.dependenciasProduto ?? []) {
    const integrado = await runGit(wt, ['merge-base', '--is-ancestor', dep.merge, 'HEAD'])
    if (integrado.err) return { ok: false, reason: 'dependencia ' + dep.produto + ' ainda nao integra a base deste worktree (' + dep.merge + ')', failureClass: 'terminal', failureReason: 'base sem entrega predecessora', cost: '', costMeasured: false }
  }
  // Uma atribuicao invalida nao pode produzir efeitos nas tarefas anteriores.
  for (const m of r.plano.microtasks) {
    if (m.ia && !harnessPorNome(m.ia.provedor).agentic) throw new Error(`microtask ${m.id}: provedor ${m.ia.provedor} nao edita arquivos`)
  }
  patchCard(id, { plano_revisao: String(r.revisao), plano_hash: r.hash }, `${isoNow()} plano v1 #${id} revisao ${r.revisao}: ${r.plano.microtasks.length} microtask(s), execucao serial`)
  const dir = join(cardsDir(), 'orquestracao')
  mkdirSync(dir, { recursive: true })
  const arquivo = join(dir, `execucao-${id}-${r.revisao}.json`)
  let checkpoint: Checkpoint = { versao: 1, hash: r.hash, feitas: [], fingerprint: '' }
  if (existsSync(arquivo)) {
    checkpoint = JSON.parse(readFileSync(arquivo, 'utf8')) as Checkpoint
    if (checkpoint.versao !== 1 || checkpoint.hash !== r.hash || !Array.isArray(checkpoint.feitas)) throw new Error('checkpoint incompativel com o plano')
    for (const tentativa of checkpoint.tentativas ?? []) {
      if (tentativa.estado !== 'executando') continue
      tentativa.estado = 'interrompida'
      tentativa.fim = isoNow()
      tentativa.motivo = 'processo anterior terminou sem resultado confirmado'
    }
    if (checkpoint.tentativas?.some(t => t.estado === 'interrompida')) {
      writeFileAtomic(arquivo, JSON.stringify(checkpoint, null, 2) + '\n')
      return { ok: false, reason: 'microtask com resultado incerto; reconcilie os efeitos e publique uma revisao do plano antes de retomar', failureClass: 'terminal', failureReason: 'resultado incerto exige reconciliacao', cost: '', costMeasured: false }
    }
    // Alteracao externa invalida o cache; o diff nunca e descartado.
    if (checkpoint.fingerprint !== await fingerprintDoTrabalho(wt)) return { ok: false, reason: 'trabalho mudou desde o checkpoint; revalide o plano antes de repetir efeitos', failureClass: 'terminal', failureReason: 'checkpoint desatualizado', cost: '0', costMeasured: true }
  }
  let custo = 0
  let medido = true
  const usage = { tokens_in: 0, tokens_out: 0, tokens_cache_create: 0, tokens_cache_read: 0 }
  let ultimo: ImplementResult = { ok: true, cost: '0', costMeasured: true, resultText: 'microtasks ja concluidas' }
  for (const onda of ondasEstritas(r.plano.microtasks)) {
    for (const m of onda) {
      if (readCard(id)?.fm.status !== 'EXECUTING') return { ...ultimo, ok: false, reason: 'execucao interrompida', cost: String(custo), costMeasured: medido, usage }
      if (checkpoint.feitas.includes(m.id)) {
        const prova = await coletarEvidencias(r.plano, r.revisao, wt, undefined, m.id)
        if (!prova.aprovado) return { ok: false, reason: 'criterios do checkpoint ' + m.id + ' nao foram comprovados; nenhum efeito foi repetido', failureClass: 'terminal', failureReason: 'checkpoint sem evidencia atual', cost: String(custo), costMeasured: medido, usage }
        const pulada = iniciar({ repo: card.fm.repo ?? '', sessao: card.fm.sessao_id || id, execucao: id }, recurso(m.agente, 'agent'), { checkpoint: r.hash })
        atualizar(pulada, a => { a.microtask = m.id; a.planoRevisao = r.revisao })
        terminar(pulada, 'skipped', 'microtask ja concluida; fingerprint do checkpoint conferido')
        continue
      }
      const gasto = gastoDoCard(card.fm.cost_usd)
      if (gasto === null || gasto + custo >= tetoDoCard()) return { ok: false, reason: 'orcamento atingido entre microtasks', failureClass: 'terminal', failureReason: 'orcamento atingido', cost: String(custo), costMeasured: medido, usage }
      patchCard(id, { microtask_atual: m.id }, `${isoNow()} microtask ${m.id}: ${m.titulo} | agente ${m.agente}`)
      const pedido: Card = { ...card, fm: { ...card.fm, title: m.titulo, orq_agente: m.agente, ...(m.ia ? { provider_override_implement: m.ia.provedor, orq_modelo: m.ia.modelo ?? '' } : {}) }, body: `## Objetivo\n${r.plano.objetivo}\n\nMICROTASK ATUAL (${m.id}):\n${m.instrucao}\nArquivos previstos: ${m.arquivos.join(', ') || 'inspecionar o projeto'}\nCriterios: ${m.criterios.join(', ')}\n` }
      const atividade = iniciar({ repo: card.fm.repo ?? '', sessao: card.fm.sessao_id || id, execucao: id }, recurso(m.agente, 'agent'), { papel: 'microtask', processoSeparado: false })
      atualizar(atividade, a => { a.microtask = m.id; a.planoRevisao = r.revisao; a.etapa = m.titulo })
      checkpoint.tentativas ??= []
      const tentativa: Tentativa = { microtask: m.id, inicio: isoNow(), fim: '', provedor: m.ia?.provedor ?? '', modelo: m.ia?.modelo ?? '', estado: 'executando', custo: '', motivo: '' }
      checkpoint.tentativas.push(tentativa)
      writeFileAtomic(arquivo, JSON.stringify(checkpoint, null, 2) + '\n')
      let concluida = false
      try {
        ultimo = await dentro(atividade, () => implementar(pedido, wt, '', visual))
        if (ultimo.ok) {
          const prova = await coletarEvidencias(r.plano, r.revisao, wt, undefined, m.id)
          if (!prova.aprovado) ultimo = { ...ultimo, ok: false, reason: 'microtask ' + m.id + ': criterios obrigatorios reprovados ou inconclusivos',
            failureClass: 'terminal', failureReason: 'evidencia da microtask nao aprovada' }
        }
        tentativa.provedor = ultimo.provider ?? tentativa.provedor
        tentativa.modelo = ultimo.model ?? tentativa.modelo
        tentativa.custo = ultimo.cost
        tentativa.motivo = ultimo.reason ?? ''
        tentativa.estado = ultimo.ok ? 'concluida' : 'falhou'
        // Atribuicao explicita exige revisao do plano, nao fallback silencioso.
        if (m.ia && !ultimo.ok && ultimo.failureClass === 'quota') ultimo = { ...ultimo, failureClass: 'terminal', failureReason: `IA atribuida a ${m.id} indisponivel: ${ultimo.failureReason ?? ultimo.reason}` }
        terminar(atividade, ultimo.ok ? 'succeeded' : 'failed', ultimo.reason ?? '')
        if (ultimo.ok) checkpoint.feitas.push(m.id)
        checkpoint.fingerprint = await fingerprintDoTrabalho(wt)
        concluida = true
      } finally {
        tentativa.fim = isoNow()
        if (!concluida) {
          tentativa.estado = 'interrompida'
          tentativa.motivo = 'microtask interrompida por excecao; resultado incerto'
          terminar(atividade, 'failed', tentativa.motivo)
        }
        writeFileAtomic(arquivo, JSON.stringify(checkpoint, null, 2) + '\n')
      }
      custo += Number(ultimo.cost) || 0
      medido &&= ultimo.costMeasured === true
      for (const k of Object.keys(usage) as (keyof typeof usage)[]) usage[k] += ultimo.usage?.[k] ?? 0
      // Uma resposta tardia nao autoriza continuar apos a parada, inclusive na ultima etapa.
      if (readCard(id)?.fm.status !== 'EXECUTING') return { ...ultimo, ok: false, reason: 'execucao interrompida', cost: String(custo), costMeasured: medido, usage }
      if (!ultimo.ok) return { ...ultimo, cost: String(custo), costMeasured: medido, usage }
    }
  }
  patchCard(id, { microtask_atual: '' }, `${isoNow()} plano: todas as microtasks concluidas; evidencias e revisao ainda pendentes`)
  return { ...ultimo, cost: String(custo), costMeasured: medido, usage }
}
