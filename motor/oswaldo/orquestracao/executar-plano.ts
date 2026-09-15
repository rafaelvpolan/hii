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
import { fingerprintDoTrabalho } from './evidencias.ts'
import { gastoDoCard, tetoDoCard } from '../../euclides/tesouro/orcamento.ts'

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
    rollout: { ativacao: 'PR aprovado pelo humano; sem merge automatico', sucesso: 'criterios obrigatorios aprovados e review liberado', interrupcao: 'falha, evidencia inconclusiva ou parada humana', reversao: 'reverter a mudanca revisada; /hii off altera somente os proximos pedidos' } }
}

interface Checkpoint { versao: 1; hash: string; feitas: string[]; fingerprint: string }

export async function executarPlano(card: Card, wt: string, implementar: (card: Card, wt: string, feedback: string, visual: boolean) => Promise<ImplementResult>, visual: boolean): Promise<ImplementResult> {
  const id = card.fm.id ?? ''
  const revisao = card.fm.plano_revisao ? Number(card.fm.plano_revisao) : undefined
  let r = lerPlano(card.fm.repo ?? '', id, revisao)
  if (!r && revisao !== undefined) throw new Error('revisao fixada do plano nao existe')
  r ??= salvarPlano(planoInicial(card, wt), 0, `inicial-${id}`)
  if (r.plano.sessaoId !== (card.fm.sessao_id || id)) throw new Error('plano pertence a outra session')
  patchCard(id, { plano_revisao: String(r.revisao), plano_hash: r.hash }, `${isoNow()} plano v1 #${id} revisao ${r.revisao}: ${r.plano.microtasks.length} microtask(s), execucao serial`)
  const dir = join(cardsDir(), 'orquestracao')
  mkdirSync(dir, { recursive: true })
  const arquivo = join(dir, `execucao-${id}-${r.revisao}.json`)
  let checkpoint: Checkpoint = { versao: 1, hash: r.hash, feitas: [], fingerprint: '' }
  if (existsSync(arquivo)) {
    checkpoint = JSON.parse(readFileSync(arquivo, 'utf8')) as Checkpoint
    if (checkpoint.versao !== 1 || checkpoint.hash !== r.hash || !Array.isArray(checkpoint.feitas)) throw new Error('checkpoint incompativel com o plano')
    // Alteracao externa invalida o cache; o diff nunca e descartado.
    if (checkpoint.fingerprint !== await fingerprintDoTrabalho(wt)) checkpoint.feitas = []
  }
  let custo = 0
  let medido = true
  const usage = { tokens_in: 0, tokens_out: 0, tokens_cache_create: 0, tokens_cache_read: 0 }
  let ultimo: ImplementResult = { ok: true, cost: '0', costMeasured: true, resultText: 'microtasks ja concluidas' }
  for (const onda of ondasEstritas(r.plano.microtasks)) {
    for (const m of onda) {
      if (checkpoint.feitas.includes(m.id)) continue
      if (readCard(id)?.fm.status !== 'EXECUTING') return { ok: false, reason: 'execucao interrompida', cost: String(custo), costMeasured: medido, usage }
      const gasto = gastoDoCard(card.fm.cost_usd)
      if (gasto === null || gasto + custo >= tetoDoCard()) return { ok: false, reason: 'orcamento atingido entre microtasks', failureClass: 'terminal', failureReason: 'orcamento atingido', cost: String(custo), costMeasured: medido, usage }
      patchCard(id, { microtask_atual: m.id }, `${isoNow()} microtask ${m.id}: ${m.titulo} | agente ${m.agente}`)
      const pedido: Card = { ...card, fm: { ...card.fm, title: m.titulo, orq_agente: m.agente }, body: `## Objetivo\n${r.plano.objetivo}\n\nMICROTASK ATUAL (${m.id}):\n${m.instrucao}\nArquivos previstos: ${m.arquivos.join(', ') || 'inspecionar o projeto'}\nCriterios: ${m.criterios.join(', ')}\n` }
      ultimo = await implementar(pedido, wt, '', visual)
      custo += Number(ultimo.cost) || 0
      medido &&= ultimo.costMeasured === true
      for (const k of Object.keys(usage) as (keyof typeof usage)[]) usage[k] += ultimo.usage?.[k] ?? 0
      if (ultimo.ok) checkpoint.feitas.push(m.id)
      checkpoint.fingerprint = await fingerprintDoTrabalho(wt)
      writeFileAtomic(arquivo, JSON.stringify(checkpoint, null, 2) + '\n')
      if (!ultimo.ok) return { ...ultimo, cost: String(custo), costMeasured: medido, usage }
    }
  }
  patchCard(id, { microtask_atual: '' }, `${isoNow()} plano: todas as microtasks concluidas; evidencias e revisao ainda pendentes`)
  return { ...ultimo, cost: String(custo), costMeasured: medido, usage }
}
