import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cardsDir } from '../../cordel/alicerce/config.ts'
import { readCard } from '../../cordel/store.ts'
import type { Fields } from '../../cordel/tipos.ts'
import { etagDe } from '../../cordel/revisao.ts'
import { run, runGit } from '../../quilombo/git.ts'
import { writeFileAtomic } from '../mutirao/trava-arquivo.ts'
import { lerPlano } from './planos.ts'
import type { RevisaoDePlano } from './planos.ts'
import { arquivoDeEvidencias, fingerprintDoTrabalho } from './evidencias.ts'
import type { RelatorioDeEvidencias } from './evidencias.ts'
import { relatorioConsistente } from './validacao-evidencias.ts'

interface Certificado {
  versao: 1; repo: string; sessao: string; execucao: string; planoHash: string
  head: string; tree: string; pr: string; relatorio: RelatorioDeEvidencias
}
export interface EntregaVerificada { head: string; tree: string; pr: string; merge: string | null }
const sha = (s: string): boolean => typeof s === 'string' && /^[a-f0-9]{40}$/.test(s)
const hash = (s: string): string => createHash('sha256').update(s).digest('hex')
function caminho(id: string, revisao: number, digest: string): string {
  if (!/^\d{3,12}$/.test(id) || !Number.isSafeInteger(revisao) || revisao < 1 || !/^[a-f0-9]{64}$/.test(digest)) throw new Error('identidade de entrega invalida')
  return join(cardsDir(), 'entregas', `${id}-${revisao}-${digest}.json`)
}
function prValido(pr: string): boolean { return /^https:\/\/[^\s/:]+\/[^\s/]+\/[^\s/]+\/pull\/\d+$/.test(pr) }

// Chamado sob a posse do executor, depois do push/PR e antes de descartar o worktree.
export async function certificarEntrega(id: string, wt: string, head: string, pr: string): Promise<string> {
  const card = readCard(id)
  if (!card || card.fm.motor_modo !== 'passivo' || ['HALTED', 'PAUSED'].includes(card.fm.status || '') || !sha(head) || !prValido(pr)) throw new Error('entrega sem execucao apta')
  if (card.fm.pushed_sha !== head) throw new Error('commit enviado diverge do card')
  const etag = etagDe(card)
  const p = lerPlano(card.fm.repo || '', id, Number(card.fm.plano_revisao))
  if (!p || p.hash !== card.fm.plano_hash || p.plano.sessaoId !== (card.fm.sessao_id || id)) throw new Error('plano da entrega diverge')
  const fonte = readFileSync(arquivoDeEvidencias(id, p.revisao), 'utf8')
  const r = JSON.parse(fonte) as RelatorioDeEvidencias
  if (!relatorioConsistente(r, p) || !r.evidencias.some(e => e.obrigatorio) || r.evidencias.some(e => e.obrigatorio && e.estado !== 'aprovado')) throw new Error('entrega sem criterios comprovados')
  const git = async (args: string[]): Promise<string> => {
    const result = await runGit(wt, ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args])
    if (result.err) throw new Error('Git indisponivel para certificar entrega')
    return result.stdout.trim()
  }
  if (await git(['status', '--porcelain', '--untracked-files=all', '--ignore-submodules=none'])) throw new Error('entrega com alteracoes nao commitadas')
  if (await git(['rev-parse', 'HEAD']) !== head || await fingerprintDoTrabalho(wt) !== r.fingerprint) throw new Error('commit enviado diverge da evidencia')
  const tree = await git(['rev-parse', 'HEAD^{tree}'])
  if (!sha(tree)) throw new Error('arvore Git invalida')
  const c: Certificado = { versao: 1, repo: p.plano.repo, sessao: p.plano.sessaoId, execucao: id, planoHash: p.hash, head, tree, pr, relatorio: r }
  const texto = JSON.stringify(c) + '\n'
  const digest = hash(texto)
  const fingerprintFinal = await fingerprintDoTrabalho(wt)
  const atual = readCard(id)
  if (!atual || etagDe(atual) !== etag || readFileSync(arquivoDeEvidencias(id, p.revisao), 'utf8') !== fonte ||
    fingerprintFinal !== r.fingerprint) throw new Error('execucao mudou durante certificacao')
  mkdirSync(join(cardsDir(), 'entregas'), { recursive: true })
  const arquivo = caminho(id, p.revisao, digest)
  if (existsSync(arquivo) && readFileSync(arquivo, 'utf8') !== texto) throw new Error('certificado existente inconsistente')
  if (!existsSync(arquivo)) writeFileAtomic(arquivo, texto)
  return digest
}

export function lerEntrega(fm: Fields, p: RevisaoDePlano): Certificado {
  const texto = readFileSync(caminho(p.plano.id, p.revisao, fm.entrega_evidencia || ''), 'utf8')
  const c = JSON.parse(texto) as Certificado
  if (hash(texto) !== fm.entrega_evidencia || c.versao !== 1 || c.repo !== p.plano.repo || c.execucao !== p.plano.id ||
    c.sessao !== p.plano.sessaoId || c.planoHash !== p.hash || c.head !== fm.pushed_sha || c.pr !== fm.pr_url ||
    !sha(c.head) || !sha(c.tree) || !prValido(c.pr) || !relatorioConsistente(c.relatorio, p)) throw new Error('certificado diverge do card/plano')
  return c
}

export async function conferirEntrega(c: Certificado, status: string, executar: typeof run = run): Promise<EntregaVerificada> {
  if (!['PR_OPEN', 'MERGED', 'DEPLOYED'].includes(status)) throw new Error('execucao ainda nao entregue')
  const remoto = await executar('gh', ['pr', 'view', c.pr, '--json', 'url,state,headRefOid,mergeCommit'], { timeout: 5000 })
  if (remoto.err) throw new Error('PR remoto indisponivel')
  const pr = JSON.parse(remoto.stdout) as { url: string; state: string; headRefOid: string; mergeCommit: { oid: string } | null }
  if (pr.url !== c.pr || pr.headRefOid !== c.head) throw new Error('head remoto diverge do commit validado')
  if (status === 'PR_OPEN') {
    if (pr.state !== 'OPEN') throw new Error('estado remoto diverge; aguarde reconciliacao')
    return { head: c.head, tree: c.tree, pr: c.pr, merge: null }
  }
  if (pr.state !== 'MERGED' || !pr.mergeCommit || !sha(pr.mergeCommit.oid)) throw new Error('merge remoto nao confirmado')
  const url = new URL(c.pr)
  const [owner, repo] = url.pathname.split('/').filter(Boolean)
  const commit = await executar('gh', ['api', '--hostname', url.hostname, `repos/${owner}/${repo}/git/commits/${pr.mergeCommit.oid}`], { timeout: 5000 })
  if (commit.err) throw new Error('commit integrado indisponivel')
  const integrado = JSON.parse(commit.stdout) as { sha: string; tree: { sha: string } }
  if (integrado.sha !== pr.mergeCommit.oid || integrado.tree?.sha !== c.tree) throw new Error('conteudo integrado difere do conteudo verificado')
  return { head: c.head, tree: c.tree, pr: c.pr, merge: integrado.sha }
}
