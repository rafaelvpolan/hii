// Canal de leitura dos comandos da pasta do Claude do motor (hii-plan, hii-review,
// hii-review-pr): chegam pela conversa e rodam na IA de verify. O motor monta o
// contexto so com git/gh de leitura e devolve uma parada, sem chamar a IA, quando
// nao ha o que revisar ou quando algo falhou. Nada e publicado no GitHub.
import { existsSync, realpathSync } from 'node:fs'
import { run } from '../git.ts'
import type { RunResult } from '../git.ts'
import { GATE_DIFF_LIMIT } from '../../cordel/alicerce/config.ts'
import { timeoutForDiff } from '../../ciclo/crivo/gate.ts'
import { providerFor } from '../../tomada/registro.ts'
import { comandosDeLeituraDaPasta } from '../../tomada/mapa/comandos.ts'

// parada sem falhou e bloqueio legitimo (arvore limpa, PR mergeado, uso errado);
// parada com falhou e falha de ferramenta (git, gh) e nunca vira sucesso.
export interface ComandoDeLeitura {
  comando: string
  instrucoes: string
  contexto: string
  timeoutMs: number
  parada?: string
  falhou: boolean
}

const TEMPO_DO_GIT_MS = 120_000
const TEMPO_DO_GH_MS = 60_000
const LIMITE_DE_NOMES = 4000
const CAMPOS_DO_PR = 'number,title,body,state,isDraft,mergedAt,latestReviews,url,baseRefName,headRefName'
// Sem refresh opcional do indice: o alvo e o mesmo clone em que o motor commita.
const AMBIENTE_DO_GIT = { GIT_OPTIONAL_LOCKS: '0' }
const AMBIENTE_DO_GH = { GH_PROMPT_DISABLED: '1' }

interface RevisaoDoPr {
  author?: { login?: string }
  state?: string
}

interface DadosDoPr {
  number?: number
  title?: string
  body?: string
  state?: string
  isDraft?: boolean
  mergedAt?: string | null
  latestReviews?: RevisaoDoPr[]
  url?: string
  baseRefName?: string
  headRefName?: string
}

function primeiraLinha(r: RunResult): string {
  const texto = [r.stderr, r.err?.message ?? ''].join('\n')
  return texto.split('\n').map(l => l.trim()).filter(Boolean)[0]?.slice(0, 200) ?? 'sem detalhe'
}

function cortado(texto: string, limite: number, aviso: string): string {
  return texto.length > limite ? `${texto.slice(0, limite)}\n${aviso}` : texto
}

function git(alvo: string, args: string[]): Promise<RunResult> {
  return run('git', args, { cwd: alvo, env: AMBIENTE_DO_GIT, timeout: TEMPO_DO_GIT_MS })
}

// Argv literal em cada chamada: o invariante de idempotencia classifica o verbo
// do gh pela linha que o invoca, e so leitura declarada passa sem a chave.
function verPr(alvo: string, n: string): Promise<RunResult> {
  return run('gh', ['pr', 'view', n, '--json', CAMPOS_DO_PR], { cwd: alvo, env: AMBIENTE_DO_GH, timeout: TEMPO_DO_GH_MS })
}

function diffDoPr(alvo: string, n: string): Promise<RunResult> {
  return run('gh', ['pr', 'diff', n], { cwd: alvo, env: AMBIENTE_DO_GH, timeout: TEMPO_DO_GH_MS })
}

function realpathOuVazio(caminho: string): string {
  try { return realpathSync(caminho) } catch { return '' }
}

// O alvo tem de ser a raiz de um repositorio: sem projeto selecionado o REPL
// passa o diretorio pai do motor, que pode estar dentro de outro repositorio.
async function semProjeto(comando: string, alvo: string): Promise<string> {
  if (!alvo.trim() || !existsSync(alvo)) return `${comando}: sem projeto selecionado — escolha com /repo <owner/nome> e repita`
  const topo = await git(alvo, ['rev-parse', '--show-toplevel'])
  const raiz = topo.err ? '' : realpathOuVazio(topo.stdout.trim())
  if (!raiz || raiz !== realpathOuVazio(alvo)) return `${comando}: sem projeto — ${alvo} nao e a raiz de um repositorio git; escolha o projeto com /repo <owner/nome> e repita`
  return ''
}

async function baseDaBranch(alvo: string): Promise<string> {
  for (const ref of ['@{u}', 'origin/HEAD', 'main', 'master']) {
    const r = await git(alvo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
    if (!r.err && r.stdout.trim()) return ref
  }
  return ''
}

type Contexto = { contexto: string } | { parada: string; falhou: boolean }

async function contextoDoDiffLocal(alvo: string): Promise<Contexto> {
  const falhou = (r: RunResult): Contexto => ({ parada: `/hii-review: git falhou ao ler o diff do projeto (${primeiraLinha(r)}); nada foi enviado para a IA`, falhou: true })
  const sujo = await git(alvo, ['diff', '--no-color', '--no-ext-diff', 'HEAD'])
  if (sujo.err) return falhou(sujo)
  const novos = await git(alvo, ['ls-files', '--others', '--exclude-standard'])
  if (novos.err) return falhou(novos)
  let patch = sujo.stdout
  let origem = 'working tree contra HEAD'
  const nomesNovos = novos.stdout.trim()
  if (!patch.trim() && !nomesNovos) {
    const base = await baseDaBranch(alvo)
    if (!base) return { parada: '/hii-review: a arvore esta limpa e nao achei base para comparar (@{u}, origin/HEAD, main ou master); nada a revisar sem uma base', falhou: false }
    const daBranch = await git(alvo, ['diff', '--no-color', '--no-ext-diff', `${base}...HEAD`])
    if (daBranch.err) return falhou(daBranch)
    patch = daBranch.stdout
    origem = `${base}...HEAD`
  }
  if (!patch.trim() && !nomesNovos) return { parada: '/hii-review: nada a revisar — a arvore esta limpa e a branch nao tem commits alem da base', falhou: false }
  return {
    contexto: [
      `DIFF (${origem}):`,
      cortado(patch, GATE_DIFF_LIMIT, '[...diff truncado...]'),
      nomesNovos ? `ARQUIVOS NOVOS NAO RASTREADOS (so os nomes):\n${cortado(nomesNovos, LIMITE_DE_NOMES, '[...lista truncada...]')}` : '',
    ].filter(Boolean).join('\n'),
  }
}

function numeroDoPr(token: string): string {
  if (!/^\d+$/.test(token)) return ''
  const n = Number(token)
  return Number.isSafeInteger(n) && n > 0 ? String(n) : ''
}

function aprovadores(pr: DadosDoPr): Set<string> {
  return new Set((pr.latestReviews ?? [])
    .filter(r => r.state === 'APPROVED' && r.author?.login)
    .map(r => r.author?.login ?? ''))
}

function portaoDoPr(n: string, pr: DadosDoPr): string {
  if (pr.state === 'MERGED' || pr.mergedAt) return `/hii-review-pr: o PR #${n} ja foi mergeado; revisao so vale antes do merge`
  if (pr.state === 'CLOSED') return `/hii-review-pr: o PR #${n} esta fechado; reabra antes de pedir revisao`
  if (pr.isDraft) return `/hii-review-pr: o PR #${n} ainda e rascunho; marque como pronto para revisao e repita`
  const aprovacoes = aprovadores(pr).size
  if (aprovacoes >= 2) return `/hii-review-pr: o PR #${n} ja tem ${aprovacoes} aprovacoes distintas; nao ha revisao a acrescentar`
  return ''
}

async function contextoDoPr(alvo: string, n: string): Promise<Contexto> {
  const falhou = (r: RunResult): Contexto => ({ parada: `/hii-review-pr: gh falhou ao ler o PR #${n} (${primeiraLinha(r)}); confira gh auth status e repita`, falhou: true })
  const visao = await verPr(alvo, n)
  if (visao.err) return falhou(visao)
  let pr: DadosDoPr
  try { pr = JSON.parse(visao.stdout) as DadosDoPr } catch { return { parada: `/hii-review-pr: gh devolveu dados ilegiveis para o PR #${n}; nada foi enviado para a IA`, falhou: true } }
  const portao = portaoDoPr(n, pr)
  if (portao) return { parada: portao, falhou: false }
  const diff = await diffDoPr(alvo, n)
  if (diff.err) return falhou(diff)
  if (!diff.stdout.trim()) return { parada: `/hii-review-pr: nada a revisar — o PR #${n} nao tem diff`, falhou: false }
  // A IA de leitura nao tem gh: o objetivo do PR so chega a ela por aqui.
  const corpo = pr.body?.trim() ?? ''
  return {
    contexto: [
      `PR #${n}: ${pr.title ?? ''} (${pr.headRefName ?? '?'} -> ${pr.baseRefName ?? '?'}) ${pr.url ?? ''}`.trim(),
      corpo ? `CORPO DO PR:\n${cortado(corpo, LIMITE_DE_NOMES, '[...corpo truncado...]')}` : 'CORPO DO PR: (vazio)',
      'DIFF DO PR (gh pr diff):',
      cortado(diff.stdout, GATE_DIFF_LIMIT, '[...diff truncado...]'),
    ].join('\n'),
  }
}

// null so quando o primeiro token nao e comando de canal leitura da pasta: "o que
// faz /hii-review?" continua sendo pergunta comum.
export async function prepararComandoDeLeitura(pergunta: string, alvo: string): Promise<ComandoDeLeitura | null> {
  const [cabeca = '', ...resto] = pergunta.trim().split(/\s+/)
  const achado = comandosDeLeituraDaPasta().find(c => c.comando.toLowerCase() === cabeca.toLowerCase())
  if (!achado) return null
  const comando = achado.comando
  const base: ComandoDeLeitura = { comando, instrucoes: achado.instrucoes ?? '', contexto: '', timeoutMs: timeoutForDiff({ names: '', patch: '' }), falhou: false }
  const parar = (parada: string, falhou = false): ComandoDeLeitura => ({ ...base, parada, falhou })
  const verify = providerFor('verify')
  if (verify.versaoDaPasta === undefined) {
    return parar(`${comando} roda com a pasta do Claude do motor, mas a IA de verify esta em ${verify.name}; troque o verify para o Claude (/ia) e repita`)
  }
  let numero = ''
  if (comando === '/hii-review-pr') {
    numero = numeroDoPr(resto[0] ?? '')
    if (!numero) return parar('uso: /hii-review-pr <numero do PR> — o numero e um inteiro positivo, como /hii-review-pr 7')
  }
  const projeto = await semProjeto(comando, alvo)
  if (projeto) return parar(projeto)
  let r: Contexto
  switch (comando) {
    case '/hii-review': r = await contextoDoDiffLocal(alvo); break
    case '/hii-review-pr': r = await contextoDoPr(alvo, numero); break
    default: r = { contexto: '' }
  }
  if ('parada' in r) return parar(r.parada, r.falhou)
  return { ...base, contexto: r.contexto, timeoutMs: timeoutForDiff({ names: '', patch: r.contexto }) }
}
