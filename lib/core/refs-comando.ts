import { basename } from 'node:path'
import { colarImagem, comoObter, depsPadrao } from '../runner/clipboard'
import type { DepsDeColagem } from '../runner/clipboard'
import { cabeNoDisco, dirDaSessao, garantirDir, MAX_REFS_POR_TAREFA, mb, refsDir, usoDeDisco } from '../runner/estado-em-disco'
import { textoDoDisco } from './render/disco'
import { anexarNaSessao, anexarNaTarefa, ehUrlDeRef, escreverFontes, fontesDaSessao, proximoBaseLocal } from '../runner/refs-anexo'
import type { Anexo } from '../runner/refs-anexo'
import { readRefSources } from '../runner/refs'
import { sessaoAtual } from '../runner/sessao'

export const PALAVRAS_DE_CLIPBOARD = ['clipboard', 'cola', 'colar', 'paste', 'print']

export interface AlvoDeRef {
  tarefa: string
  sessao: string
}

export interface ResultadoDeRef {
  ok: boolean
  linhas: string[]
}

export interface DepsDeRef {
  colar: (destinoSemExt: string, deps?: DepsDeColagem) => Promise<{ ok: boolean; motivo: string; caminho: string; bytes: number }>
  clipboard: DepsDeColagem
}

function depsDeRef(): DepsDeRef {
  return { colar: colarImagem, clipboard: depsPadrao() }
}

export function alvoDeRef(tarefa: string): AlvoDeRef {
  return { tarefa, sessao: sessaoAtual() }
}

function dirDoAlvo(alvo: AlvoDeRef): string {
  return alvo.tarefa ? refsDir(alvo.tarefa) : dirDaSessao(alvo.sessao)
}

function fontesDoAlvo(alvo: AlvoDeRef): string[] {
  return alvo.tarefa ? readRefSources(alvo.tarefa) : fontesDaSessao(alvo.sessao)
}

function ondeFica(alvo: AlvoDeRef): string {
  return alvo.tarefa ? `tarefa #${alvo.tarefa}` : 'sessao (vai junto com a proxima tarefa que voce escrever)'
}

function rotuloDaFonte(fonte: string): string {
  return ehUrlDeRef(fonte) ? fonte : basename(fonte)
}

function linhaDeDisco(): string {
  return `  ${textoDoDisco(usoDeDisco(), { detalhe: true })}`
}

function listarRefs(alvo: AlvoDeRef): ResultadoDeRef {
  const fontes = fontesDoAlvo(alvo)
  const linhas = [`  referencias de ${ondeFica(alvo)}`]
  if (!fontes.length) {
    linhas.push('  nenhuma ainda — /ref <url|caminho> anexa, /ref clipboard cola a imagem copiada')
  } else {
    fontes.forEach((f, i) => linhas.push(`  ${i + 1}. ${rotuloDaFonte(f)}`))
    linhas.push(`  ${fontes.length}/${MAX_REFS_POR_TAREFA} — a IA abre cada uma na implementacao`)
  }
  linhas.push(linhaDeDisco())
  return { ok: true, linhas }
}

function mensagemDeAnexo(a: Anexo, alvo: AlvoDeRef, comoVeio: string): ResultadoDeRef {
  if (!a.ok) return { ok: false, linhas: [`  ${a.motivo}`] }
  const linhas = [
    `  referencia ${a.total}/${MAX_REFS_POR_TAREFA} anexada a ${ondeFica(alvo)}${comoVeio}`,
    `  ${rotuloDaFonte(a.fonte)}`,
  ]
  const uso = usoDeDisco()
  if (uso.nivel !== 'ok') linhas.push(linhaDeDisco())
  return { ok: true, linhas }
}

async function colarDoClipboard(alvo: AlvoDeRef, deps: DepsDeRef): Promise<ResultadoDeRef> {
  const fontes = fontesDoAlvo(alvo)
  if (fontes.length >= MAX_REFS_POR_TAREFA) {
    return { ok: false, linhas: [`  ja ha ${fontes.length} referencias, o teto e ${MAX_REFS_POR_TAREFA}`] }
  }
  const espaco = cabeNoDisco(0)
  if (!espaco.ok) return { ok: false, linhas: [`  ${espaco.motivo}`] }
  const dir = garantirDir(dirDoAlvo(alvo))
  const r = await deps.colar(proximoBaseLocal(dir), deps.clipboard)
  if (!r.ok) return { ok: false, linhas: [`  ${r.motivo}`] }
  const total = alvo.tarefa
    ? escreverFontes(alvo.tarefa, [...fontes, r.caminho]).length
    : anexarNaSessao(alvo.sessao, r.caminho).total
  return mensagemDeAnexo(
    { ok: true, motivo: '', fonte: r.caminho, copiado: r.caminho, total },
    alvo,
    ` — ${mb(r.bytes)} do clipboard`,
  )
}

export async function comandoRef(
  arg: string,
  alvo: AlvoDeRef,
  deps: DepsDeRef = depsDeRef(),
): Promise<ResultadoDeRef> {
  const bruto = arg.trim()
  if (!bruto) return listarRefs(alvo)
  if (PALAVRAS_DE_CLIPBOARD.includes(bruto.toLowerCase())) return colarDoClipboard(alvo, deps)
  if (bruto === 'ambiente') {
    const amb = deps.clipboard.ambiente()
    return { ok: true, linhas: [`  clipboard: ${amb === 'nenhum' ? comoObter(amb) : amb}`, linhaDeDisco()] }
  }
  const a = alvo.tarefa ? anexarNaTarefa(alvo.tarefa, bruto) : anexarNaSessao(alvo.sessao, bruto)
  return mensagemDeAnexo(a, alvo, ehUrlDeRef(bruto) ? ' — baixa na execucao, com as guardas de rede' : ' — copiada para o estado do motor')
}
