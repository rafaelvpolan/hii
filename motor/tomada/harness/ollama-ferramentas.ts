import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { AgentMode } from '../tipos.ts'
import { withFileLock, writeFileAtomic } from '../../oswaldo/mutirao/trava-arquivo.ts'

export interface ChamadaDeFerramentaOllama {
  function?: { name?: string; arguments?: Record<string, string | number | boolean | null> }
}

export const FERRAMENTAS_OLLAMA = [
  {
    type: 'function',
    function: {
      name: 'read_file', description: 'Le um arquivo UTF-8 dentro do workspace.',
      parameters: { type: 'object', required: ['path'], properties: { path: { type: 'string' } }, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'replace_text', description: 'Substitui uma ocorrencia exata em um arquivo existente do workspace.',
      parameters: { type: 'object', required: ['path', 'old_text', 'new_text'], properties: {
        path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' },
      }, additionalProperties: false },
    },
  },
] as const

const LIMITE_ARQUIVO = 512 * 1024

function caminhoPermitido(cwd: string, dirs: readonly string[], entrada: string | number | boolean | null | undefined): string {
  if (typeof entrada !== 'string' || !entrada || isAbsolute(entrada) || /^[a-z]:[\\/]|^\\\\/i.test(entrada) || entrada.includes('\0')) throw new Error('path deve ser relativo ao workspace')
  if (entrada.split(/[\\/]+/).includes('..')) throw new Error('traversal recusado no path da ferramenta')
  const candidato = resolve(realpathSync(cwd), entrada)
  const raizes = [...new Set([cwd, ...dirs])].map(caminho => realpathSync(caminho))
  const raiz = raizes.find(item => relative(item, candidato) === '' || (!relative(item, candidato).startsWith('..') && !isAbsolute(relative(item, candidato))))
  if (!raiz) throw new Error('path fora das raizes permitidas')
  let cursor = raiz
  for (const parte of relative(raiz, candidato).split('/').filter(Boolean)) {
    cursor = join(cursor, parte)
    if (lstatSync(cursor).isSymbolicLink()) throw new Error('symlink recusado no path da ferramenta')
  }
  const real = realpathSync(candidato)
  const info = lstatSync(real)
  if (info.isSymbolicLink() || !info.isFile()) throw new Error('path nao e arquivo regular')
  if (info.size > LIMITE_ARQUIVO) throw new Error('arquivo excede 512 KiB')
  return real
}

function texto(args: Record<string, string | number | boolean | null>, campo: string): string {
  const valor = args[campo]
  if (typeof valor !== 'string') throw new Error(campo + ' deve ser string')
  return valor
}

export function executarFerramentaOllama(chamada: ChamadaDeFerramentaOllama, cwd: string, dirs: readonly string[], modo: AgentMode): string {
  const nome = chamada.function?.name
  const args = chamada.function?.arguments
  if (!nome || !args || typeof args !== 'object' || Array.isArray(args)) throw new Error('chamada de ferramenta invalida')
  const caminho = caminhoPermitido(cwd, dirs, args.path)
  if (nome === 'read_file') return readFileSync(caminho, 'utf8')
  if (nome !== 'replace_text') throw new Error('ferramenta desconhecida: ' + nome)
  if (modo !== 'edit') throw new Error('replace_text recusada em modo somente leitura')
  const antigo = texto(args, 'old_text')
  const novo = texto(args, 'new_text')
  withFileLock(caminho, () => {
    const antes = readFileSync(caminho, 'utf8')
    if (!antigo || antes.split(antigo).length !== 2) throw new Error('old_text deve ocorrer exatamente uma vez')
    const depois = antes.replace(antigo, novo)
    if (Buffer.byteLength(depois) > LIMITE_ARQUIVO) throw new Error('resultado excede 512 KiB')
    writeFileAtomic(caminho, depois)
  })
  return 'substituicao aplicada'
}
