import { diagnosticarPlanoLegado, aplicarPlanoLegado } from './recuperacao-plano.ts'
import { hashRecuperacao } from './recuperacao.ts'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { cardsDir } from '../cordel/alicerce/config.ts'
import { allCards, readCard, repoPath, updateCardPorAcaoHumana } from '../cordel/store.ts'
import { splitFrontMatter } from '../cordel/frontmatter.ts'
import { etagDe } from '../cordel/revisao.ts'
import { runGit } from '../quilombo/git.ts'
import { fingerprintDoTrabalho } from '../oswaldo/orquestracao/evidencias.ts'
import { motivoParaEsperarHarness } from '../tomada/harness-em-voo.ts'
import { snapshotsDaExecucao } from '../euclides/snapshot-execucao.ts'
import { estadoMotor } from './estado-motor.ts'
import { ErroApi } from './contrato.ts'
import type { PacoteRecuperacao } from './recuperacao.ts'

export interface DiagnosticoRecuperacao {
  versao: 1; tarefa: string; revisao: string; origem: string; status: string
  preparada: boolean; podePreparar: boolean; bloqueios: string[]; avisos: string[]
  worktree: string; branch: string; fingerprint: string
  plano?: { origemId: string; revisao: number; concluidas: string[]; total: number }
  configuracao: string | null; snapshots: ReturnType<typeof snapshotsDaExecucao>
  motor: ReturnType<typeof estadoMotor>
}
export async function diagnosticarRecuperacao(id: string): Promise<DiagnosticoRecuperacao> {
  const card = readCard(id)
  if (!card) throw new ErroApi(404, 'tarefa_ausente', 'tarefa nao encontrada')
  const d: DiagnosticoRecuperacao = { versao: 1, tarefa: id, revisao: etagDe(card), origem: card.fm.recuperacao_origem || '',
    status: card.fm.status || '', preparada: !!card.fm.recuperacao_preparada && card.fm.recuperacao_pendente !== 'true', podePreparar: false, bloqueios: [], avisos: [], worktree: '', branch: '', fingerprint: '',
    configuracao: card.fm.recuperacao_config || null, snapshots: [], motor: estadoMotor() }
  try { d.snapshots = snapshotsDaExecucao(id) }
  catch { d.bloqueios.push('Snapshot de configuracao ilegivel; preserve o arquivo e reconcilie antes de restaurar.') }
  if (!['PAUSED', 'HALTED'].includes(d.status)) d.bloqueios.push('Pare a tarefa antes de preparar a recuperacao.')
  if (motivoParaEsperarHarness(id)) d.bloqueios.push('Existe harness em voo; aguarde encerramento confirmado.')
  let fm = card.fm
  let pacote: PacoteRecuperacao | null = null
  if (d.origem) {
    if (!/^[a-f0-9]{64}$/.test(d.origem)) { d.bloqueios.push('Identidade da origem invalida.'); return { ...d, preparada: false } }
    const arquivo = join(cardsDir(), 'recuperacao', 'importacoes', d.origem + '.json')
    if (!existsSync(arquivo)) { d.bloqueios.push('Arquivo de origem ausente; nenhuma retomada autorizada.'); return { ...d, preparada: false } }
    try {
      const salvo = JSON.parse(readFileSync(arquivo, 'utf8')) as { pacote: PacoteRecuperacao; hash: string }
      if (salvo.hash !== card.fm.recuperacao_hash || hashRecuperacao(salvo.pacote) !== salvo.hash) { d.bloqueios.push('Hash da origem diverge do vinculo.'); return { ...d, preparada: false } }
      pacote = salvo.pacote
      fm = splitFrontMatter(salvo.pacote.documento).fm
    } catch { d.bloqueios.push('Arquivo de origem ilegivel; original preservado para reconciliacao.'); return { ...d, preparada: false } }
    if (!['PAUSED', 'HALTED', 'INBOX', 'READY'].includes(fm.status || '')) d.bloqueios.push('A origem ainda pode estar executando; pare e reconcilie antes de importar.')
    if (fm.pr_url || fm.entrega_evidencia) d.bloqueios.push('Origem registra entrega externa; reconcilie o PR antes de repetir qualquer etapa.')
    if (card.fm.recuperacao_adotada) fm = card.fm
    if (!d.snapshots.length) d.avisos.push('Origem sem snapshot verificavel; configuracao original desconhecida.')
    d.avisos.push('Historico original preservado. A etapa de implementacao sera revalidada e pode exigir novas chamadas de IA.')
  }
  if (fm.worktree) {
    try {
      const wt = realpathSync(fm.worktree)
      const repo = realpathSync(repoPath(card.fm.repo || ''))
      const lista = await runGit(repo, ['worktree', 'list', '--porcelain'])
      if (lista.err || !lista.stdout.split('\n').includes('worktree ' + wt)) throw new Error('worktree nao pertence ao projeto registrado')
      if (wt === repo) throw new Error('clone principal nao pode ser adotado como worktree de recuperacao')
      const branch = await runGit(wt, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
      if (branch.err || !fm.branch || branch.stdout.trim() !== fm.branch) throw new Error('branch mudou ou nao foi registrada')
      if (allCards().some(c => c.id !== id && c.worktree && resolve(c.worktree) === wt && !['PAUSED', 'HALTED', 'COMPLETED', 'MERGED', 'DEPLOYED', 'PR_OPEN'].includes(c.status || ''))) throw new Error('outro card utiliza o worktree')
      d.worktree = wt; d.branch = branch.stdout.trim()
      d.fingerprint = await fingerprintDoTrabalho(wt)
    } catch { d.bloqueios.push('Worktree ausente, alterado ou fora do projeto registrado; arquivos nao foram modificados.') }
  } else if (Number(fm.cost_usd || '0') !== 0 || !!fm.cost_unverified || !!fm.cost_floor || fm.plano_revisao || fm.branch) {
    d.bloqueios.push('Ha tentativa anterior sem worktree comprovado; localize os artefatos antes de retomar.')
  } else d.avisos.push('Nao ha worktree anterior registrado; a retomada preparara uma nova area de trabalho.')
  if (pacote && !card.fm.recuperacao_adotada) {
    try {
      const m = diagnosticarPlanoLegado(pacote, d.fingerprint)
      if (m) d.plano = { origemId: m.origemId, revisao: m.revisaoAtiva, concluidas: [...m.checkpoint.feitas],
        total: m.revisoes.find(r => r.revisao === m.revisaoAtiva)!.plano.microtasks.length }
    } catch (e) { d.bloqueios.push(String((e as Error).message)) }
  }
  if (etagDe(readCard(id)!) !== d.revisao) d.bloqueios.push('Tarefa mudou durante o diagnostico; consulte novamente.')
  d.preparada = d.preparada && d.bloqueios.length === 0 && (!!card.fm.recuperacao_adotada || !card.fm.recuperacao_fingerprint || card.fm.recuperacao_fingerprint === d.fingerprint)
  d.podePreparar = d.bloqueios.length === 0 && !d.preparada
  return d
}
export function confirmarPreparacao(d: DiagnosticoRecuperacao): void {
  if (!d.origem) throw new ErroApi(409, 'vinculo_ausente', 'preparacao destina-se a tarefas importadas')
  if (!d.podePreparar) throw new ErroApi(409, 'recuperacao_bloqueada', d.bloqueios.join(' '))
  updateCardPorAcaoHumana(d.tarefa, {
    fields: atual => {
      if (!['PAUSED', 'HALTED'].includes(atual.status || '') || motivoParaEsperarHarness(d.tarefa)) throw new ErroApi(409, 'estado_alterado', 'tarefa deixou de estar parada')
      const arquivo = join(cardsDir(), 'recuperacao', 'importacoes', d.origem + '.json')
      const salvo = JSON.parse(readFileSync(arquivo, 'utf8')) as { pacote: PacoteRecuperacao; hash: string }
      if (salvo.hash !== atual.recuperacao_hash || hashRecuperacao(salvo.pacote) !== salvo.hash) throw new ErroApi(409, 'origem_alterada', 'Arquivo de origem diverge do vinculo.')
      const migracao = diagnosticarPlanoLegado(salvo.pacote, d.fingerprint)
      const plano = migracao ? aplicarPlanoLegado(d.tarefa, d.origem, migracao) : {}
      return { ...plano, recuperacao_pendente: '', recuperacao_preparada: d.revisao,
        recuperacao_fingerprint: d.fingerprint, ...(d.worktree ? { worktree: d.worktree, branch: d.branch } : {}),
        retomar_em: 'EXECUTING' }
    },
    log: new Date().toISOString() + ' recuperacao preparada; original e arquivos preservados; aguardando retomada explicita',
  })
}
