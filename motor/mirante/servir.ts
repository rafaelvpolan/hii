import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cardsDir, PREVIEW_BASE_PORT } from '../cordel/alicerce/config.ts'
import { readCard, repoPath } from '../cordel/store.ts'
import { isoNow, slugify } from '../cordel/util.ts'
import { readContract } from '../cordel/bussola/armazenar.ts'
import { devCommand, hasCommand } from './comandos.ts'
import { setUrlPid } from './acoes.ts'
import { ensureUrl, httpOk, pidAlive, stopUrl, urlPort, waitHttp } from '../ciclo/crivo/url-viva.ts'

// Mirante — `/serve`: sobe (ou reaproveita) o modo dev do que a pessoa esta olhando.
//
// O motor ja sobe o preview de um card quando ele entra em EXECUTING; o que faltava
// era a pessoa pedir isso na hora que quiser — card pausado com url caida, ou o
// proprio projeto registrado, fora de qualquer tarefa. Mesmo comando `dev` do
// contrato, mesma porta por card, e o projeto ganha a porta base (cards comecam em 1).

export interface ServidorDoProjeto {
  repo: string
  pid: number
  port: number
  iniciadoEm: string
}

export type AlvoDoServe =
  | { readonly kind: 'projeto'; readonly repo: string; readonly dir: string; readonly port: number }
  | { readonly kind: 'card'; readonly id: string; readonly repo: string; readonly dir: string; readonly port: number; readonly pidConhecido: string }

export type PedidoDeServe =
  | { readonly acao: 'subir' | 'parar' | 'status'; readonly alvo: '' | 'projeto' | string }
  | { readonly acao: 'ajuda' }

const TENTATIVAS_DE_ESPERA = 20

export function interpretarServe(arg: string): PedidoDeServe {
  const partes = arg.trim().split(/\s+/).filter(Boolean)
  const palavras = new Set(partes.map(p => p.toLowerCase()))
  const acao = palavras.has('stop') || palavras.has('parar') ? 'parar' : palavras.has('status') ? 'status' : 'subir'
  const resto = partes.filter(p => !['stop', 'parar', 'status'].includes(p.toLowerCase()))
  if (resto.length > 1) return { acao: 'ajuda' }
  const alvo = (resto[0] ?? '').toLowerCase()
  if (alvo === 'projeto' || alvo === 'project' || alvo === 'repo') return { acao, alvo: 'projeto' }
  if (alvo && !/^\d{1,4}$/.test(alvo)) return { acao: 'ajuda' }
  return { acao, alvo: alvo ? String(Number(alvo)).padStart(3, '0') : '' }
}

function arquivoDoServidor(repo: string): string {
  return join(cardsDir(), 'urls', 'projeto', `${slugify(repo)}.json`)
}

export function lerServidor(repo: string): ServidorDoProjeto | null {
  try {
    const s = JSON.parse(readFileSync(arquivoDoServidor(repo), 'utf8')) as Partial<ServidorDoProjeto>
    const pid = Number(s.pid)
    const port = Number(s.port)
    if (!pid || !port) return null
    return { repo, pid, port, iniciadoEm: String(s.iniciadoEm ?? '') }
  } catch {
    return null
  }
}

function gravarServidor(s: ServidorDoProjeto): void {
  const arquivo = arquivoDoServidor(s.repo)
  mkdirSync(join(arquivo, '..'), { recursive: true })
  writeFileSync(arquivo, JSON.stringify(s) + '\n')
}

function esquecerServidor(repo: string): void {
  try { rmSync(arquivoDoServidor(repo), { force: true }) } catch { void 0 }
}

export function resolverAlvo(pedido: Exclude<PedidoDeServe, { acao: 'ajuda' }>, repo: string, seguindo: string): AlvoDoServe | string {
  const idPedido = pedido.alvo === 'projeto' ? '' : pedido.alvo || seguindo
  if (pedido.alvo !== 'projeto' && idPedido) {
    const card = readCard(idPedido)
    if (!card) return `card #${idPedido} nao encontrado`
    const wt = String(card.fm.worktree ?? '')
    if (!wt || !existsSync(wt)) {
      if (pedido.alvo) return `#${idPedido} nao tem worktree (${String(card.fm.status ?? '')}) — o preview de um card so existe depois que ele executou; use /serve projeto para o repo`
    } else {
      return { kind: 'card', id: idPedido, repo: String(card.fm.repo ?? repo), dir: wt, port: urlPort(idPedido), pidConhecido: String(card.fm.url_pid ?? '') }
    }
  }
  if (!repo) return 'nenhum projeto escolhido — use /repo <owner/nome> primeiro'
  const dir = repoPath(repo)
  if (!dir || !existsSync(dir)) return `o clone de ${repo} nao esta em disco (${dir || 'caminho vazio'})`
  return { kind: 'projeto', repo, dir, port: PREVIEW_BASE_PORT }
}

function nomeDo(alvo: AlvoDoServe): string {
  return alvo.kind === 'card' ? `#${alvo.id}` : alvo.repo
}

function urlDe(port: number): string {
  return `http://localhost:${port}`
}

function pidConhecidoDe(alvo: AlvoDoServe): string {
  if (alvo.kind === 'card') return alvo.pidConhecido
  return String(lerServidor(alvo.repo)?.pid ?? '')
}

function lembrarPid(alvo: AlvoDoServe, pid: number): void {
  if (alvo.kind === 'card') setUrlPid(alvo.id, pid)
  else gravarServidor({ repo: alvo.repo, pid, port: alvo.port, iniciadoEm: isoNow() })
}

async function subir(alvo: AlvoDoServe): Promise<string[]> {
  const contrato = readContract(alvo.kind === 'card' ? repoPath(alvo.repo) : alvo.dir)
  if (!contrato) return [`${nomeDo(alvo)}: sem contrato em ${repoPath(alvo.repo)}/.hii/contract.json — registre o alvo (hii registrar) antes de servir`]
  if (!hasCommand(contrato, 'dev')) return [`${nomeDo(alvo)}: o contrato nao declara commands.dev — declare o comando de modo dev em .hii/contract.json`]
  const cmd = devCommand(contrato, alvo.port)
  const h = await ensureUrl(alvo.dir, alvo.port, repoPath(alvo.repo), pidConhecidoDe(alvo))
  if (!h.pid) return [`${nomeDo(alvo)}: nao consegui iniciar "${cmd?.label ?? 'dev'}" em ${alvo.dir}`]
  if (h.reused) return [`${nomeDo(alvo)}: o modo dev ja esta de pe (pid ${h.pid})`, `  ${urlDe(alvo.port)}`]
  lembrarPid(alvo, h.pid)
  const respondeu = await waitHttp(urlDe(alvo.port), TENTATIVAS_DE_ESPERA)
  const linha = `${nomeDo(alvo)}: modo dev subiu (pid ${h.pid}) — ${cmd?.label ?? 'dev'} em ${alvo.dir}`
  const url = `  ${urlDe(alvo.port)}`
  return respondeu ? [linha, url] : [linha, url, `  ainda nao responde — de mais alguns segundos; se nao subir, rode o comando a mao nesse diretorio para ver o erro`]
}

async function parar(alvo: AlvoDoServe): Promise<string[]> {
  const pid = pidConhecidoDe(alvo)
  if (!pidAlive(pid)) {
    if (alvo.kind === 'projeto') esquecerServidor(alvo.repo)
    return [`${nomeDo(alvo)}: nao havia modo dev de pe`]
  }
  stopUrl(pid)
  if (alvo.kind === 'projeto') esquecerServidor(alvo.repo)
  else setUrlPid(alvo.id, 0)
  return [`${nomeDo(alvo)}: modo dev parado (pid ${pid})`]
}

async function status(alvo: AlvoDoServe): Promise<string[]> {
  const pid = pidConhecidoDe(alvo)
  const vivo = pidAlive(pid)
  const responde = vivo && await httpOk(urlDe(alvo.port))
  if (!vivo) return [`${nomeDo(alvo)}: modo dev parado — /serve${alvo.kind === 'card' ? ` ${alvo.id}` : ''} sobe em ${urlDe(alvo.port)}`]
  return [`${nomeDo(alvo)}: modo dev ${responde ? 'de pe' : 'com processo vivo mas sem responder'} (pid ${pid})`, `  ${urlDe(alvo.port)}`]
}

export const AJUDA_DO_SERVE = 'uso: /serve [id|projeto] [stop|status] — sobe o modo dev da tarefa aberta (ou do projeto), para ou mostra o estado'

export async function comandoServir(arg: string, repo: string, seguindo: string): Promise<string[]> {
  const pedido = interpretarServe(arg)
  if (pedido.acao === 'ajuda') return [AJUDA_DO_SERVE]
  const alvo = resolverAlvo(pedido, repo, seguindo)
  if (typeof alvo === 'string') return [alvo]
  if (pedido.acao === 'parar') return parar(alvo)
  if (pedido.acao === 'status') return status(alvo)
  return subir(alvo)
}
