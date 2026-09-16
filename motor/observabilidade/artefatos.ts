import { createHash } from 'node:crypto'
import { closeSync, constants, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readdirSync, lstatSync, unlinkSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { cardsDir } from '../cordel/alicerce/config.ts'
import { writeFileAtomic } from '../oswaldo/mutirao/trava-arquivo.ts'
import { textoPublico, jsonPublico } from './registro.ts'
import type { Json } from '../api/contrato.ts'
import type { Escopo } from './contrato.ts'

export interface Artefato extends Escopo { id: string; nome: string; tipo: 'application/json' | 'text/plain' | 'text/markdown'; tamanho: number; sha256: string; expira: string; conteudo: string }
const diretorio = (): string => join(cardsDir(), 'observabilidade', 'artefatos')
const MAX_BYTES = 262144
export function registrarArtefato(escopo: Escopo, nome: string, tipo: Artefato['tipo'], texto: string): string | null {
  try {
    const conteudo = tipo === 'application/json' ? JSON.stringify(jsonPublico(JSON.parse(texto) as Json)) : textoPublico(texto)
    if (Buffer.byteLength(conteudo) > MAX_BYTES) return null
    const sha256 = createHash('sha256').update(conteudo).digest('hex')
    const id = createHash('sha256').update(JSON.stringify([escopo, nome, tipo, sha256])).digest('hex')
    const a: Artefato = { ...escopo, id, nome, tipo, tamanho: Buffer.byteLength(conteudo), sha256, expira: new Date(Date.now() + 7 * 86400000).toISOString(), conteudo }
    const observabilidade = join(cardsDir(), 'observabilidade')
    mkdirSync(observabilidade, { recursive: true })
    if (realpathSync(observabilidade) !== join(realpathSync(cardsDir()), 'observabilidade')) return null
    mkdirSync(diretorio(), { recursive: true })
    if (realpathSync(diretorio()) !== join(realpathSync(cardsDir()), 'observabilidade', 'artefatos')) return null
    const arquivos = readdirSync(diretorio()).filter(n => /^[a-f0-9]{64}\.json$/.test(n))
    for (const f of arquivos) if (!lerArtefato(f.slice(0, -5))) unlinkSync(join(diretorio(), f))
    if (readdirSync(diretorio()).length >= 512 && !existsSync(join(diretorio(), `${id}.json`))) return null
    writeFileAtomic(join(diretorio(), `${id}.json`), JSON.stringify(a))
    return id
  } catch { return null }
}
export function lerArtefato(id: string): Artefato | null {
  if (!/^[a-f0-9]{64}$/.test(id)) return null
  let fd: number | undefined
  try {
    const dir = diretorio()
    if (lstatSync(dir).isSymbolicLink() || realpathSync(dir) !== join(realpathSync(cardsDir()), 'observabilidade', 'artefatos')) return null
    fd = openSync(join(dir, `${id}.json`), constants.O_RDONLY | constants.O_NOFOLLOW)
    const stat = fstatSync(fd)
    if (!stat.isFile() || stat.size > MAX_BYTES * 6 + 4096) return null
    const a = JSON.parse(readFileSync(fd, 'utf8')) as Artefato
    if (a.id !== id || !['application/json', 'text/plain', 'text/markdown'].includes(a.tipo) || !Number.isFinite(Date.parse(a.expira)) || Date.parse(a.expira) <= Date.now() || Buffer.byteLength(a.conteudo) > MAX_BYTES || a.tamanho !== Buffer.byteLength(a.conteudo) || createHash('sha256').update(a.conteudo).digest('hex') !== a.sha256) return null
    return a
  } catch { return null } finally { if (fd !== undefined) closeSync(fd) }
}
export function listarArtefatos(execucao: string): Omit<Artefato, 'conteudo'>[] {
  if (!existsSync(diretorio())) return []
  return readdirSync(diretorio()).flatMap(f => {
    const a = lerArtefato(f.replace(/\.json$/, ''))
    if (!a || a.execucao !== execucao) return []
    const { conteudo: _conteudo, ...meta } = a
    return [meta]
  })
}
