import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DIR_GERADO, EXT_AUDITAVEL, EXT_SEM_EXPORT, FATOR_TESTE, GOD_EXPORTS, GOD_FUNCS,
  LINHAS_DO_TOPO, MAX_LINHAS, PESO_GOD_FILE, PESO_MONOLITO, PESO_POR_LINHA,
  PESO_SEM_TESTE, RE_ALLOW_MONOLITO,
} from './tipos.ts'
import type { ArquivoAuditavel, ForaDaAuditoria } from './tipos.ts'
import { ehArquivoDeTeste, extensaoDe, temTesteCorrespondente } from './cobertura.ts'
import type { CoberturaDeTeste } from './cobertura.ts'

// ASS — a MEDICAO de um arquivo: quanto ele pesa, e por que ele e risco.
// Separado da selecao porque medir um arquivo nao precisa saber nada sobre
// lotes, orcamento ou escopo.

export function lerTexto(raiz: string, path: string): string | null {
  try {
    return readFileSync(join(raiz, path), 'utf8')
  } catch {
    return null
  }
}

function scriptDeVue(text: string): string {
  const blocos = text.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi)
  if (!blocos) return ''
  return blocos.map(b => b.replace(/^<script\b[^>]*>/i, '').replace(/<\/script>$/i, '')).join('\n')
}

function linhasDeCodigo(text: string): number {
  return text.split('\n').filter(l => l.trim() !== '').length
}

function contaFuncoes(text: string): number {
  const declaradas = (text.match(/\bfunction\b/g) ?? []).length
  const setas = (text.match(/\b(?:const|let|var)\s+[\w$]+\s*(?::[^=\n]+)?=\s*(?:async\s+)?(?:\([^)]*\)|[\w$]+)\s*(?::[^=\n]+)?=>/g) ?? []).length
  const python = (text.match(/^\s*def\s+\w+/gm) ?? []).length
  return declaradas + setas + python
}

function contaExports(text: string): number {
  return (text.match(/\bexport\b/g) ?? []).length + (text.match(/\bmodule\.exports\b/g) ?? []).length
}

export function metricasDe(path: string, texto: string, cobertura: CoberturaDeTeste): ArquivoAuditavel {
  const ext = extensaoDe(path)
  const codigo = ext === 'vue' ? scriptDeVue(texto) : texto
  const linhas = linhasDeCodigo(codigo)
  const funcoes = contaFuncoes(codigo)
  const exports = contaExports(codigo)
  const excedeLinhas = linhas > MAX_LINHAS
  const godFile = !EXT_SEM_EXPORT.has(ext) && funcoes >= GOD_FUNCS && exports < GOD_EXPORTS
  const ehTeste = ehArquivoDeTeste(path)
  const semTeste = !temTesteCorrespondente(path, cobertura)
  const sancionado = texto.split('\n', LINHAS_DO_TOPO).some(l => RE_ALLOW_MONOLITO.test(l)) && (excedeLinhas || godFile)
  const motivos: string[] = []
  if (excedeLinhas) motivos.push(`monolito: ${linhas} linhas (limite ${MAX_LINHAS})`)
  if (godFile) motivos.push(`god-file: ${funcoes} funcoes e ${exports} export(s)`)
  if (sancionado) motivos.push('divida assumida via hicode:allow-monolith — o hook do repo nao bloqueia este arquivo')
  if (semTeste) motivos.push('sem teste correspondente')
  if (ehTeste) motivos.push('arquivo de teste — risco reduzido, codigo de producao vem antes')
  const bruto =
    (excedeLinhas && !sancionado ? PESO_MONOLITO : 0) +
    (godFile && !sancionado ? PESO_GOD_FILE : 0) +
    (semTeste ? PESO_SEM_TESTE : 0) +
    Math.round(linhas * PESO_POR_LINHA * 10) / 10
  const risco = Math.round(bruto * (ehTeste ? FATOR_TESTE : 1) * 10) / 10
  return { path, chars: texto.length, linhas, funcoes, exports, excedeLinhas, godFile, semTeste, risco, motivos }
}

export function rejeitarPorCaminho(path: string): Omit<ForaDaAuditoria, 'path'> | null {
  const p = path.toLowerCase()
  for (const dir of DIR_GERADO) {
    if (p.startsWith(dir) || p.includes(`/${dir}`)) return { motivo: 'diretorio-gerado', detalhe: `dentro de ${dir}` }
  }
  if (/\.d\.[cm]?ts$/.test(p)) return { motivo: 'extensao-nao-auditavel', detalhe: 'declaracao de tipos (.d.ts)' }
  const ext = extensaoDe(path)
  if (!EXT_AUDITAVEL.has(ext)) return { motivo: 'extensao-nao-auditavel', detalhe: ext ? `extensao .${ext}` : 'sem extensao' }
  return null
}
