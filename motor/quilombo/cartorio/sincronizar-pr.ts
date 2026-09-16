import { run } from '../git.ts'
import type { PedidoDePr, AberturaDePr } from './pr.ts'

const INICIO = '<!-- hii:inicio -->'
const FIM = '<!-- hii:fim -->'

export function corpoGerenciado(atual: string, novo: string): string {
  const bloco = `${INICIO}\n${novo}\n${FIM}`
  const inicio = atual.indexOf(INICIO)
  const fim = atual.indexOf(FIM, inicio)
  if (inicio < 0 && fim < 0) return [atual.trimEnd(), bloco].filter(Boolean).join('\n\n')
  if (inicio < 0 || fim < inicio || atual.indexOf(INICIO, inicio + 1) >= 0 || atual.indexOf(FIM, fim + FIM.length) >= 0) throw new Error('marcadores HII inconsistentes; corpo humano preservado')
  return atual.slice(0, inicio) + bloco + atual.slice(fim + FIM.length)
}

interface PrRemoto { number: number; url: string; state: string; body: string }

export async function sincronizarPr(p: PedidoDePr, executar: typeof run = run): Promise<AberturaDePr> {
  const opcoes = { cwd: p.worktree, timeout: 60000 }
  const lista = await executar('gh', ['pr', 'list', '--repo', p.repoName, '--head', p.branch, '--base', p.base, '--state', 'all', '--json', 'number,url,state,body'], opcoes)
  if (lista.err) return { url: '', reaproveitada: false, erro: `consulta de PR falhou: ${lista.stderr || lista.err.message}` }
  let encontrados: PrRemoto[]
  try {
    encontrados = JSON.parse(lista.stdout) as PrRemoto[]
    if (!Array.isArray(encontrados) || encontrados.some(p => !Number.isInteger(p.number) || !/^https:\/\//.test(p.url) || typeof p.body !== 'string' || !['OPEN', 'CLOSED', 'MERGED'].includes(p.state))) throw new Error('resposta invalida')
  } catch { return { url: '', reaproveitada: false, erro: 'consulta de PR retornou JSON invalido' } }
  const abertos = encontrados.filter(p => p.state === 'OPEN')
  if (abertos.length > 1 || (!abertos.length && encontrados.length)) return { url: '', reaproveitada: false, erro: 'branch com PR encerrado ou ambiguo; decisao humana necessaria' }
  const existente = abertos[0]
  if (p.prExistente && existente?.url !== p.prExistente) return { url: '', reaproveitada: false, erro: 'PR registrado diverge do remoto' }
  const corpo = corpoGerenciado(existente?.body ?? '', p.corpo)
  if (existente) {
    if (corpo !== existente.body) {
      const edit = await executar('gh', ['pr', 'edit', String(existente.number), '--repo', p.repoName, '--body', corpo], opcoes)
      if (edit.err) return { url: '', reaproveitada: true, erro: edit.stderr || edit.err.message }
    }
    return { url: existente.url, reaproveitada: true, erro: '' }
  }
  const criado = await executar('gh', ['pr', 'create', '--repo', p.repoName, '--base', p.base, '--head', p.branch, '--title', p.titulo, '--body', corpo], opcoes)
  const url = criado.stdout.trim().split('\n').at(-1) ?? ''
  return criado.err || !/^https:\/\/[^\s]+\/pull\/\d+$/.test(url)
    ? { url: '', reaproveitada: false, erro: criado.stderr || criado.err?.message || 'URL de PR invalida' }
    : { url, reaproveitada: false, erro: '' }
}
