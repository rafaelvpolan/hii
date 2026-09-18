import { readCard, patchCard } from '../cordel/store.ts'
import { fingerprintDoTrabalho } from '../oswaldo/orquestracao/evidencias.ts'

/** A prova de importacao vale ate o primeiro despacho; depois valem os checkpoints do motor. */
export async function adotarRecuperacao(id: string): Promise<void> {
  const fm = readCard(id)?.fm
  if (!fm?.recuperacao_origem || fm.recuperacao_adotada) return
  if (fm.recuperacao_pendente === 'true' || !fm.recuperacao_preparada) throw new Error('Recuperacao ainda nao preparada')
  if (fm.recuperacao_fingerprint && (!fm.worktree || await fingerprintDoTrabalho(fm.worktree) !== fm.recuperacao_fingerprint)) {
    throw new Error('Worktree mudou apos a previa de recuperacao; diagnostique novamente antes de executar')
  }
  const atual = readCard(id)?.fm
  if (!atual || !['EXECUTING', 'CORRECTING', 'REFINED', 'TESTS_GREEN', 'SEC_CLEARED', 'REVIEWED', 'CLEANED'].includes(atual.status || '') ||
    atual.recuperacao_preparada !== fm.recuperacao_preparada) throw new Error('Tarefa mudou antes da adocao da recuperacao')
  patchCard(id, { recuperacao_adotada: new Date().toISOString() })
}
