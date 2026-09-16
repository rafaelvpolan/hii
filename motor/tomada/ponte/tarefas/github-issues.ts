import { run } from '../../../quilombo/git.ts'
import type { Fields } from '../../../cordel/index.ts'
import { executarComIdempotencia, FASE_DA_PONTE } from '../../../quilombo/salvo-conduto/idempotencia.ts'
import type { ExternalTask, TaskSync } from './tipos.ts'

interface GhIssue { number?: number; title?: string; body?: string | null; pull_request?: { url?: string } }

function primeiraLinha(texto: string): string {
  return String(texto || '').split('\n').filter(Boolean)[0]?.slice(0, 200) ?? 'sem detalhe'
}

export function parseIssues(stdout: string, origem = ''): ExternalTask[] {
  const arr = JSON.parse(stdout) as GhIssue[]
  if (!Array.isArray(arr)) throw new Error('gh respondeu JSON que nao e lista de issues')
  return arr.filter(i => !i?.pull_request).map(i => {
    if (!i || !Number.isSafeInteger(i.number) || Number(i.number) < 1 || typeof i.title !== 'string' || (i.body != null && typeof i.body !== 'string')) throw new Error('issue com numero, titulo ou corpo invalido')
    return { externalId: String(i.number), title: i.title, body: i.body ?? '',
      ...(origem ? { source: `github-issues#${origem}/issues/${i.number}`, repo: new URL(origem).pathname.slice(1) } : {}) }
  })
}

export function origemGithub(valor: string): string {
  const url = new URL(valor)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !/^\/[\w.-]+\/[\w.-]+\/?$/.test(url.pathname)) throw new Error('repositorio GitHub invalido')
  return `${url.origin}${url.pathname.replace(/\/$/, '')}`
}

export class GithubIssuesSync implements TaskSync {
  readonly name = 'github-issues'
  private readonly run: typeof run
  constructor(executar: typeof run = run) { this.run = executar }

  async pull(): Promise<ExternalTask[]> {
    const repo = process.env.HII_GH_REPO || ''
    const r = await this.run('gh', ['repo', 'view', ...(repo ? [repo] : []), '--json', 'url'], { timeout: 30000 })
    if (r.err) throw new Error(`gh repo view falhou: ${primeiraLinha(r.stderr)}`)
    const info = JSON.parse(r.stdout) as { url?: string }
    const origem = origemGithub(info.url ?? '')
    const url = new URL(origem)
    const leitura = await this.run('gh', ['api', '--method', 'GET', '--hostname', url.hostname, '--paginate', '--slurp',
      `repos${url.pathname}/issues?state=open&per_page=100`], { timeout: 120000 })
    if (leitura.err) throw new Error(`gh api falhou — nenhuma lista parcial sera importada: ${primeiraLinha(leitura.stderr)}`)
    const paginas = JSON.parse(leitura.stdout) as GhIssue[][]
    if (!Array.isArray(paginas) || !paginas.every(Array.isArray)) throw new Error('gh api respondeu sem paginas de issues')
    const tarefas = paginas.flatMap(pagina => parseIssues(JSON.stringify(pagina), origem))
    return [...new Map(tarefas.map(t => [t.source, t])).values()]
  }

  async push(card: Fields): Promise<boolean> {
    const source = String(card.source || '')
    if (!source.startsWith('github-issues#')) return false
    const ref = source.slice('github-issues#'.length)
    let destino: string
    if (/^https:\/\//.test(ref)) {
      const url = new URL(ref)
      const partes = url.pathname.match(/^(\/[\w.-]+\/[\w.-]+)\/issues\/([1-9]\d*)$/)
      if (!partes) throw new Error('origem de issue invalida')
      destino = `${origemGithub(url.origin + partes[1])}/issues/${partes[2]}`
      if (url.search || url.hash || url.username || url.password) throw new Error('origem de issue invalida')
    } else {
      if (!/^[1-9]\d*$/.test(ref)) throw new Error('numero de issue invalido')
      const repo = process.env.HII_GH_REPO || ''
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || card.repo !== repo) throw new Error('origem legada ambigua; associe repo e HII_GH_REPO antes de espelhar')
      destino = `https://github.com/${repo}/issues/${ref}`
    }
    const status = String(card.status ?? '')
    const body = `hicode: card #${card.id} → ${status}${card.pr_url ? ` · PR ${card.pr_url}` : ''}`
    const feito = await executarComIdempotencia({
      card: String(card.id ?? ''), fase: FASE_DA_PONTE, operacao: /^[1-9]\d*$/.test(ref) ? `issue_comment:${status}` : `issue_comment:${destino}:${status}`,
      executar: async (): Promise<string> => {
        const r = await this.run('gh', ['issue', 'comment', destino, '--body', body], { timeout: 30000 })
        if (r.err) throw new Error(`gh issue comment falhou: ${primeiraLinha(r.stderr)}`)
        return r.stdout.trim() || `comentado em ${destino}`
      },
    })
    return !feito.reaproveitada
  }
}
