import { execFileSync } from 'node:child_process'
import { readCard } from '../../cdl/store.ts'
import { eventosDoCard } from '../../euc/eventos.ts'
import { renderSituacao } from '../render/situacao.ts'
import { atividadeDe, larguraUtil } from './dados.ts'
import { color } from './saida.ts'

// A ponte entre o renderizador puro (render/situacao.ts) e o disco: le o card, o
// diario de eventos, a atividade do harness e o diff do worktree.
//
// O diff e a unica parte que sai do processo. Vem com try E com TIMEOUT: isto roda
// de dentro do desenho da TUI, sincrono, e um git preso (index.lock de outro
// processo no mesmo worktree, disco lento) congelaria a tela inteira. Dois segundos
// e mais que suficiente para um `diff --name-only`; estourar significa "nao sei
// quais arquivos", que a tela ja sabe representar (a linha some).
const TIMEOUT_DO_DIFF_MS = 2000

function tocados(worktree: string): string[] {
  if (!worktree) return []
  try {
    return execFileSync('git', ['diff', '--name-only', 'HEAD'], {
      cwd: worktree, encoding: 'utf8', timeout: TIMEOUT_DO_DIFF_MS, stdio: ['ignore', 'pipe', 'ignore'],
    }).split('\n').map(l => l.trim()).filter(Boolean)
  } catch {
    return []
  }
}

export function situacaoDoCard(id: string): string[] {
  const card = readCard(id)
  if (!card) return [`  card #${id} nao encontrado`]
  return renderSituacao({
    fm: card.fm,
    eventos: eventosDoCard(id),
    atividades: atividadeDe(id),
    tocados: tocados(String(card.fm.worktree ?? '')),
  }, { color, width: larguraUtil() })
}
