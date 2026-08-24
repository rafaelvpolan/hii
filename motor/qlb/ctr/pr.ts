import { executarComIdempotencia } from '../slv/idempotencia.ts'
import { run } from '../git.ts'

export function pularCriacaoDePr(prUrl: string): boolean {
  return String(prUrl ?? '').trim().length > 0
}

export interface PedidoDePr {
  readonly card: string
  readonly repoName: string
  readonly base: string
  readonly branch: string
  readonly titulo: string
  readonly corpo: string
  readonly worktree: string
  // URL que o card JA tem. Preenchida = nao chama o gh.
  readonly prExistente: string
}

export interface AberturaDePr {
  readonly url: string
  // true = a url veio do diario/do card, e o `gh` NAO foi chamado nesta execucao.
  readonly reaproveitada: boolean
  readonly erro: string
}

const TIMEOUT_GH_MS = 60000

// Abrir PR e efeito externo IRREVERSIVEL, e por isso ha duas guardas em serie:
//
//  1. `prExistente` — o card ja sabe a url. Nao chama o gh.
//  2. a chave de idempotencia (SLV) — o diario ja registrou a abertura. O guarda
//     antigo era so `card.fm.pr_url`, gravado DEPOIS do gh e depois de remover o
//     worktree: morrer nesse meio deixava pr_url vazio, o reconcileStranded
//     devolvia o card para URL_OK e o finish abria um SEGUNDO PR.
//
// Extraido de handleFinish com `executar` injetavel porque a guarda 1 so era
// verificavel por leitura de texto-fonte: o teste afirmava sobre a ORDEM das linhas
// no arquivo, e apontar `prExistente` para um campo que ninguem escreve mantinha
// tudo verde com o segundo PR de volta.
export async function abrirPrUmaVez(p: PedidoDePr, executar: typeof run = run): Promise<AberturaDePr> {
  let erro = ''
  let chamouOGh = false
  const r = await executarComIdempotencia({
    card: p.card,
    fase: 'ctr',
    operacao: 'pr_create',
    executar: async (): Promise<string> => {
      if (p.prExistente) return p.prExistente
      chamouOGh = true
      const pr = await executar('gh', ['pr', 'create', '--repo', p.repoName, '--base', p.base, '--head', p.branch, '--title', p.titulo, '--body', p.corpo], { cwd: p.worktree, timeout: TIMEOUT_GH_MS })
      const saida = String(pr.stdout || '').trim().split('\n').filter(Boolean).pop() || ''
      if (pr.err && !saida) erro = String(pr.stderr || '').slice(0, 120)
      return saida
    },
  })
  return { url: r.resultado, reaproveitada: r.reaproveitada || !chamouOGh, erro }
}
