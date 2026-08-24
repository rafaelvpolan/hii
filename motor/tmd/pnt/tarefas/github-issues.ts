import { run } from '../../../qlb/git.ts'
import type { Fields } from '../../../cdl/index.ts'
import { executarComIdempotencia } from '../../../qlb/slv/idempotencia.ts'
import type { ExternalTask, TaskSync } from './tipos.ts'

interface GhIssue {
  number?: number
  title?: string
  body?: string
}

// PNT — espelho de tarefa externa. Duas regras aqui, e as duas nasceram de
// defeito medido:
//
// 1. FALHA NAO VIRA LISTA VAZIA. `gh` ausente, sem login ou fora de cota devolvia
//    err, o err era descartado e `pull` respondia []. O CLI imprimia "0 cards
//    criados, N espelhados de 0 externos" com exit 0 — sucesso anunciado sobre
//    trabalho que nao aconteceu, num comando cuja unica funcao e falar com o
//    mundo de fora.
// 2. COMENTARIO E EFEITO EXTERNO. Ele passa por SLV. Antes ficava fora, e dois
//    `hii sync` no mesmo card geravam dois comentarios na mesma issue.

function repoArgs(): string[] {
  const repo = process.env.HICODE_GH_REPO || ''
  return repo ? ['--repo', repo] : []
}

function primeiraLinha(texto: string): string {
  return String(texto || '').split('\n').filter(Boolean)[0]?.slice(0, 200) ?? 'sem detalhe'
}

export function parseIssues(stdout: string): ExternalTask[] {
  const arr = JSON.parse(stdout) as GhIssue[]
  if (!Array.isArray(arr)) {
    throw new Error(`gh issue list devolveu JSON que nao e lista: ${stdout.slice(0, 120)}`)
  }
  return arr.filter(i => i.number != null).map(i => ({ externalId: String(i.number), title: String(i.title ?? ''), body: String(i.body ?? '') }))
}

export class GithubIssuesSync implements TaskSync {
  readonly name = 'github-issues'

  async pull(): Promise<ExternalTask[]> {
    const r = await run('gh', ['issue', 'list', '--json', 'number,title,body', '--state', 'open', '--limit', '50', ...repoArgs()], { timeout: 30000 })
    if (r.err) {
      throw new Error(`gh issue list falhou — nenhuma issue foi lida (isto NAO significa "nenhuma issue aberta"): ${primeiraLinha(r.stderr) || r.err.message}`)
    }
    try {
      return parseIssues(r.stdout)
    } catch (e) {
      throw new Error(`gh issue list respondeu, mas a saida nao e a lista esperada: ${String((e as Error).message)}`)
    }
  }

  // `true` = comentou agora. `false` = a chave ja estava no diario e nada foi
  // postado. Antes devolvia `void` e o chamador contava tudo como "espelhado",
  // imprimindo N para efeito que nao aconteceu nesta execucao.
  async push(card: Fields): Promise<boolean> {
    const num = String(card.source || '').split('#').pop() || ''
    if (!num) return false
    const status = String(card.status ?? '')
    const body = `hicode: card #${card.id} → ${status}${card.pr_url ? ` · PR ${card.pr_url}` : ''}`
    // A chave inclui o STATUS: espelhar a mudanca de estado uma vez e o objetivo;
    // repetir o mesmo estado a cada sync e ruido na issue de outra pessoa.
    const feito = await executarComIdempotencia({
      card: String(card.id ?? ''),
      fase: 'pnt',
      operacao: `issue_comment:${status}`,
      executar: async (): Promise<string> => {
        const r = await run('gh', ['issue', 'comment', num, '--body', body, ...repoArgs()], { timeout: 30000 })
        if (r.err) {
          throw new Error(`gh issue comment #${num} falhou: ${primeiraLinha(r.stderr) || r.err.message}`)
        }
        // Resultado nao-vazio e o que marca o efeito como produzido no diario.
        return String(r.stdout || '').trim() || `comentado em #${num}`
      },
    })
    return !feito.reaproveitada
  }
}
