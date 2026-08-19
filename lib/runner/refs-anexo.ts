import { copyFileSync, existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { MAX_FILESIZE_BYTES } from './download'
import { cabeNoDisco, dirDaSessao, garantirDir, MAX_REFS_POR_TAREFA, refsDir, refsFile } from './estado-em-disco'
import { readRefSources } from './refs'

export const EXT_DE_IMAGEM = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.bmp']
const PARECE_URL = /^https?:\/\//i
const PREFIXO_LOCAL = 'local-'
const FONTES_DA_SESSAO = 'fontes.json'

export function ehUrlDeRef(entrada: string): boolean {
  return PARECE_URL.test(entrada.trim())
}

export function ehImagem(caminho: string): boolean {
  return EXT_DE_IMAGEM.includes(extname(caminho).toLowerCase())
}

function lerLista(arquivo: string): string[] {
  if (!existsSync(arquivo)) return []
  try {
    const cru = JSON.parse(readFileSync(arquivo, 'utf8')) as string[]
    return Array.isArray(cru) ? cru.map(s => String(s)).filter(Boolean) : []
  } catch {
    return []
  }
}

function gravarLista(arquivo: string, fontes: string[]): string[] {
  const unicas = [...new Set(fontes.filter(Boolean))].slice(0, MAX_REFS_POR_TAREFA)
  writeFileSync(arquivo, `${JSON.stringify(unicas, null, 2)}\n`)
  return unicas
}

export function escreverFontes(id: string, fontes: string[]): string[] {
  garantirDir(refsDir(id))
  return gravarLista(refsFile(id), fontes)
}

export function proximoBaseLocal(dir: string): string {
  const usados = existsSync(dir)
    ? readdirSync(dir).filter(f => f.startsWith(PREFIXO_LOCAL)).length
    : 0
  return join(dir, `${PREFIXO_LOCAL}${usados + 1}`)
}

export interface Anexo {
  ok: boolean
  motivo: string
  fonte: string
  copiado: string
  total: number
}

function recusa(motivo: string, total = 0): Anexo {
  return { ok: false, motivo, fonte: '', copiado: '', total }
}

function tamanho(caminho: string): number {
  try {
    return statSync(caminho).size
  } catch {
    return 0
  }
}

interface Validado {
  erro: string
  bytes: number
}

function validarArquivoLocal(caminho: string): Validado {
  if (!existsSync(caminho)) return { erro: `nao achei o arquivo: ${caminho}`, bytes: 0 }
  let ehArquivo = false
  try {
    ehArquivo = statSync(caminho).isFile()
  } catch {
    ehArquivo = false
  }
  if (!ehArquivo) return { erro: `${caminho} nao e arquivo`, bytes: 0 }
  if (!ehImagem(caminho)) {
    return { erro: `${basename(caminho)} nao tem extensao de imagem (${EXT_DE_IMAGEM.join(' ')})`, bytes: 0 }
  }
  const bytes = tamanho(caminho)
  if (bytes === 0) return { erro: `${basename(caminho)} esta vazio`, bytes }
  if (bytes > MAX_FILESIZE_BYTES) {
    return { erro: `${basename(caminho)} tem ${bytes} bytes, acima do teto de ${MAX_FILESIZE_BYTES}`, bytes }
  }
  return { erro: '', bytes }
}

function copiarPara(dir: string, origem: string): string {
  const destino = `${proximoBaseLocal(garantirDir(dir))}${extname(origem).toLowerCase()}`
  copyFileSync(origem, destino)
  return destino
}

function dentroDe(dir: string, caminho: string): boolean {
  return resolve(caminho).startsWith(`${resolve(dir)}/`)
}

function anexar(dir: string, arquivoDeFontes: string, atuais: string[], entrada: string): Anexo {
  const bruto = entrada.trim()
  if (!bruto) return recusa('diga a url ou o caminho da imagem', atuais.length)
  garantirDir(dir)
  if (atuais.length >= MAX_REFS_POR_TAREFA) {
    return recusa(`ja ha ${atuais.length} referencias, o teto e ${MAX_REFS_POR_TAREFA}`, atuais.length)
  }
  if (ehUrlDeRef(bruto)) {
    const total = gravarLista(arquivoDeFontes, [...atuais, bruto]).length
    return { ok: true, motivo: '', fonte: bruto, copiado: '', total }
  }
  if (dentroDe(dir, bruto)) {
    const total = gravarLista(arquivoDeFontes, [...atuais, resolve(bruto)]).length
    return { ok: true, motivo: '', fonte: resolve(bruto), copiado: resolve(bruto), total }
  }
  const v = validarArquivoLocal(bruto)
  if (v.erro) return recusa(v.erro, atuais.length)
  const espaco = cabeNoDisco(v.bytes)
  if (!espaco.ok) return recusa(espaco.motivo, atuais.length)
  const copiado = copiarPara(dir, bruto)
  const total = gravarLista(arquivoDeFontes, [...atuais, copiado]).length
  return { ok: true, motivo: '', fonte: copiado, copiado, total }
}

export function anexarNaTarefa(id: string, entrada: string): Anexo {
  return anexar(refsDir(id), refsFile(id), readRefSources(id), entrada)
}

export function arquivoDeFontesDaSessao(sessao: string): string {
  return join(dirDaSessao(sessao), FONTES_DA_SESSAO)
}

export function fontesDaSessao(sessao: string): string[] {
  return lerLista(arquivoDeFontesDaSessao(sessao))
}

export function anexarNaSessao(sessao: string, entrada: string): Anexo {
  const dir = garantirDir(dirDaSessao(sessao))
  return anexar(dir, arquivoDeFontesDaSessao(sessao), fontesDaSessao(sessao), entrada)
}

function mover(origem: string, destino: string): void {
  try {
    renameSync(origem, destino)
  } catch {
    copyFileSync(origem, destino)
    rmSync(origem, { force: true })
  }
}

export interface Migracao {
  migrados: number
  fontes: string[]
}

export function migrarRefsDaSessao(sessao: string, id: string): Migracao {
  const daSessao = fontesDaSessao(sessao)
  if (!daSessao.length) return { migrados: 0, fontes: readRefSources(id) }
  const dir = garantirDir(refsDir(id))
  const origem = dirDaSessao(sessao)
  const novas: string[] = []
  let migrados = 0
  for (const fonte of daSessao) {
    if (ehUrlDeRef(fonte)) {
      novas.push(fonte)
      migrados += 1
      continue
    }
    if (!existsSync(fonte)) continue
    const destino = `${proximoBaseLocal(dir)}${extname(fonte).toLowerCase()}`
    mover(fonte, destino)
    novas.push(destino)
    migrados += 1
  }
  const fontes = escreverFontes(id, [...readRefSources(id), ...novas])
  rmSync(origem, { recursive: true, force: true })
  return { migrados, fontes }
}

export function limparSessao(sessao: string): void {
  rmSync(dirDaSessao(sessao), { recursive: true, force: true })
}
