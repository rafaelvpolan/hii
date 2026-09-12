import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { memoArquivo } from '../../tomada/eco/memo.ts'

const SHA_CURTO = 7

export function arquivoHead(dir: string): string {
  const ponto = join(dir, '.git')
  try {
    if (statSync(ponto).isDirectory()) return join(ponto, 'HEAD')
    const gitdir = readFileSync(ponto, 'utf8').replace(/^gitdir:\s*/, '').trim()
    return join(isAbsolute(gitdir) ? gitdir : resolve(dir, gitdir), 'HEAD')
  } catch {
    return ponto
  }
}

export function branchDoHead(conteudo: string): string {
  const linha = conteudo.trim()
  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(linha)
  if (ref) return ref[1] ?? ''
  return linha.slice(0, SHA_CURTO)
}

function lerBranch(dir: string): string {
  const head = arquivoHead(dir)
  if (!existsSync(head)) return ''
  try {
    return branchDoHead(readFileSync(head, 'utf8'))
  } catch {
    return ''
  }
}

export const branchAtual: (dir: string) => string = memoArquivo(arquivoHead, lerBranch)
