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
  configuracao: string | null; snapshots: ReturnType<typeof snapshotsDaExecucao>
  motor: ReturnType<typeof estadoMotor>
}
export async function diagnosticarRecuperacao(id: string): Promise<DiagnosticoRecuperacao> {
  const card = readCard(id)
  if (!card) throw new ErroApi(404, 'tarefa_ausente', 'tarefa nao encontrada')
  const d: DiagnosticoRecuperacao = { versao: 1, tarefa: id, revisao: etagDe(card), origem: card.fm.recuperacao_origem || '',
    status: card.fm.status || '', preparada: !!card.fm.recuperacao_preparada && card.fm.recuperacao_pendente !== 'true', podePreparar: false, bloqueios: [], avisos: [], worktree: '', branch: '', fingerprint: '',
    configuracao: card.fm.recuperacao_config || null, snapshots: snapshotsDaExecucao(id), motor: estadoMotor() }
  if (!['PAUSED', 'HALTED'].includes(d.status)) d.bloqueios.push('Pare a tarefa antes de preparar a recuperacao.')
  if (motivoParaEsperarHarness(id)) d.bloqueios.push('Existe harness em voo; aguarde encerramento confirmado.')
  let fm = card.fm
  if (d.origem) {
    const arquivo = join(cardsDir(), 'recuperacao', 'importacoes', d.origem + '.json')
    if (!existsSync(arquivo)) { d.bloqueios.push('Arquivo de origem ausente; nenhuma retomada autorizada.'); return d }
    const salvo = JSON.parse(readFileSync(arquivo, 'utf8')) as { pacote: PacoteRecuperacao; hash: string }
    if (salvo.hash !== card.fm.recuperacao_hash || hashRecuperacao(salvo.pacote) !== salvo.hash) { d.bloqueios.push('Hash da origem diverge do vinculo.'); return d }
    fm = splitFrontMatter(salvo.pacote.documento).fm
    if (!['PAUSED', 'HALTED', 'INBOX', 'READY'].includes(fm.status || '')) d.bloqueios.push('A origem ainda pode estar executando; pare e reconcilie antes de importar.')
    if (fm.pr_url || fm.entrega_evidencia) d.bloqueios.push('Origem registra entrega externa; reconcilie o PR antes de repetir qualquer etapa.')
    if (fm.plano_revisao || fm.plano_hash) d.bloqueios.push('Plano legado requer transferencia e validacao do checkpoint; manter pausada.')
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
  } else if (Number(fm.cost_usd || '0') !== 0 || fm.cost_unverified === 'true' || fm.plano_revisao || fm.branch) {
    d.bloqueios.push('Ha tentativa anterior sem worktree comprovado; localize os artefatos antes de retomar.')
  } else d.avisos.push('Nao ha worktree anterior registrado; a retomada preparara uma nova area de trabalho.')
  if (etagDe(readCard(id)!) !== d.revisao) d.bloqueios.push('Tarefa mudou durante o diagnostico; consulte novamente.')
  d.preparada = d.preparada && d.bloqueios.length === 0 && (!card.fm.recuperacao_fingerprint || card.fm.recuperacao_fingerprint === d.fingerprint)
  d.podePreparar = d.bloqueios.length === 0 && !d.preparada
  return d
}
export function confirmarPreparacao(d: DiagnosticoRecuperacao): void {
  if (!d.origem) throw new ErroApi(409, 'vinculo_ausente', 'preparacao destina-se a tarefas importadas')
  if (!d.podePreparar) throw new ErroApi(409, 'recuperacao_bloqueada', d.bloqueios.join(' '))
  updateCardPorAcaoHumana(d.tarefa, {
    fields: atual => {
      if (!['PAUSED', 'HALTED'].includes(atual.status || '') || motivoParaEsperarHarness(d.tarefa)) throw new ErroApi(409, 'estado_alterado', 'tarefa deixou de estar parada')
      return { recuperacao_pendente: '', recuperacao_preparada: d.revisao,
        recuperacao_fingerprint: d.fingerprint, ...(d.worktree ? { worktree: d.worktree, branch: d.branch } : {}),
        retomar_em: 'EXECUTING' }
    },
    log: new Date().toISOString() + ' recuperacao preparada; original e arquivos preservados; aguardando retomada explicita',
  })
}
