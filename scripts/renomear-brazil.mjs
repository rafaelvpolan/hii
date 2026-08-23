#!/usr/bin/env node
// Onda 1 do WORKFLOW-EXECUCAO.md — rename estrutural BRAZIL.
// O mapa NAO mora aqui: e lido de ARQUITETURA-BRAZIL.md §5, para doc e script
// nunca divergirem. Uso:
//   bun scripts/renomear-brazil.mjs                    valida tudo, nao escreve
//   bun scripts/renomear-brazil.mjs --dominio=cdl      valida so um dominio
//   bun scripts/renomear-brazil.mjs --dominio=cdl --aplicar
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { join, dirname, relative, resolve, extname } from 'node:path'
import { execFileSync } from 'node:child_process'

const RAIZ = process.cwd()
const DOC = 'ARQUITETURA-BRAZIL.md'
export const ORIGENS = ['lib', 'bin/lib']
export const TOTAL_ESPERADO = 172
const PULAR_DIR = new Set(['node_modules', '.git', '.nuxt', '.output', 'dist'])
const EXT_TEXTO = new Set(['.ts', '.tsx', '.mts', '.mjs', '.js', '.json', '.md', '.sh', '.yml'])
const EXT_MODULO = ['.ts', '.tsx', '.mts', '.mjs', '.js']

// ---------- mapa ----------

export function lerMapaDoDoc() {
  const texto = readFileSync(join(RAIZ, DOC), 'utf8')
  const i = texto.indexOf('## 5. Mapa de rename')
  const f = texto.indexOf('## 6. ')
  if (i < 0 || f < 0) throw new Error(`${DOC}: secao 5 nao encontrada`)
  const pares = []
  const prefixos = []
  const linha = /^\|\s*`([^`]+)`[^|]*\|\s*(?:`([^`]+)`|\*inalterado\*)\s*\|/
  for (const l of texto.slice(i, f).split('\n')) {
    const m = linha.exec(l)
    if (!m) continue
    const [, origem, destino] = m
    if (!destino) continue                      // *inalterado*
    if (origem.endsWith('/**')) prefixos.push([origem.slice(0, -2), destino.slice(0, -2)])
    else pares.push([origem, destino])
  }
  return { pares, prefixos }
}

function caminharTs(dir, acc) {
  if (!existsSync(dir)) return acc
  for (const nome of readdirSync(dir)) {
    if (PULAR_DIR.has(nome)) continue
    const p = join(dir, nome)
    if (statSync(p).isDirectory()) caminharTs(p, acc)
    else if (p.endsWith('.ts')) acc.push(p)
  }
  return acc
}

export function expandir({ pares, prefixos }) {
  const fora = new Map(pares)
  for (const [de, para] of prefixos) {
    // antes do rename os arquivos estao na origem; depois, no destino. Expande do
    // lado que existir, para o mapa continuar completo nos dois estados.
    const naOrigem = caminharTs(de, [])
    if (naOrigem.length) {
      for (const a of naOrigem) fora.set(a, para + a.slice(de.length))
    } else {
      for (const a of caminharTs(para, [])) fora.set(de + a.slice(para.length), a)
    }
  }
  return [...fora].sort((a, b) => a[0].localeCompare(b[0]))
}

// Estado de cada par. Invariante que vale ANTES, DURANTE e DEPOIS da Onda 1:
// exatamente um lado existe. 'ambos' = move pela metade; 'nenhum' = arquivo sumiu.
export function conferirEstado(todos) {
  const fora = { origem: [], destino: [], ambos: [], nenhum: [] }
  for (const [o, d] of todos) {
    const temO = existsSync(o)
    const temD = existsSync(d)
    if (temO && temD) fora.ambos.push([o, d])
    else if (temO) fora.origem.push([o, d])
    else if (temD) fora.destino.push([o, d])
    else fora.nenhum.push([o, d])
  }
  return fora
}

export function dominioDe(destino) {
  const p = destino.split('/')
  return p[0] === 'motor' ? p[1] : p[0]
}

// ---------- validacao ----------

export function validar(todos) {
  const erros = []
  const naOrigem = ORIGENS.flatMap(d => caminharTs(d, []))

  for (const [o] of todos) if (!existsSync(o)) erros.push(`origem inexistente: ${o}`)
  for (const [, d] of todos) if (existsSync(d)) erros.push(`destino ja ocupado: ${d}`)

  const mapeadas = new Set(todos.map(([o]) => o))
  for (const f of naOrigem) if (!mapeadas.has(f)) erros.push(`arquivo fora do mapa: ${f}`)

  const vistos = new Map()
  for (const [o, d] of todos) {
    if (vistos.has(d)) erros.push(`destino duplicado: ${d} (${vistos.get(d)} e ${o})`)
    vistos.set(d, o)
  }

  if (todos.length !== naOrigem.length) erros.push(`mapa tem ${todos.length} entradas, disco tem ${naOrigem.length} .ts`)
  if (todos.length !== TOTAL_ESPERADO) erros.push(`total ${todos.length} != ${TOTAL_ESPERADO} declarado no doc`)
  return erros
}

// ---------- imports ----------

const ESPECIFICADOR = /(\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(['"])(\.[^'"\n]*)\2/g

function arquivosDeTexto() {
  const acc = []
  const anda = dir => {
    for (const nome of readdirSync(dir)) {
      if (PULAR_DIR.has(nome)) continue
      const p = join(dir, nome)
      if (statSync(p).isDirectory()) anda(p)
      else if (EXT_TEXTO.has(extname(p))) acc.push(relative(RAIZ, p))
    }
  }
  anda(RAIZ)
  return acc
}

function resolverAlvo(deArquivo, spec) {
  const base = relative(RAIZ, resolve(RAIZ, dirname(deArquivo), spec))
  if (extname(base) && existsSync(base)) return base
  for (const e of EXT_MODULO) if (existsSync(base + e)) return base + e
  for (const e of EXT_MODULO) if (existsSync(join(base, 'index' + e))) return join(base, 'index' + e)
  return null
}

function novoSpec(deArquivoNovo, alvoNovo, specAntigo) {
  let destino = alvoNovo
  const tinhaExtensao = /\.(ts|tsx|mts|mjs|js)$/.test(specAntigo)
  if (!tinhaExtensao) {
    destino = destino.replace(/\.(ts|tsx|mts|mjs|js)$/, '')
    if (destino.endsWith('/index') && !specAntigo.endsWith('/index')) destino = dirname(destino)
  }
  let rel = relative(dirname(deArquivoNovo), destino).split('\\').join('/')
  if (!rel.startsWith('.')) rel = './' + rel
  return rel
}

// ---------- aplicacao ----------

function aplicar(lote, aplicarDeVerdade) {
  const renomeados = new Map(lote)

  // 1. fotografa os imports ANTES de mover, resolvendo cada um contra o disco atual
  const foto = new Map()
  for (const arquivo of arquivosDeTexto()) {
    const texto = readFileSync(arquivo, 'utf8')
    const itens = []
    for (const m of texto.matchAll(ESPECIFICADOR)) {
      const alvo = resolverAlvo(arquivo, m[3])
      if (alvo) itens.push({ spec: m[3], alvo })
    }
    if (itens.length) foto.set(arquivo, itens)
  }

  if (!aplicarDeVerdade) return { movidos: lote.length, tocados: 0, dados: 0 }

  // 2. move
  for (const [o, d] of lote) {
    mkdirSync(dirname(d), { recursive: true })
    execFileSync('git', ['mv', o, d], { cwd: RAIZ })
  }

  // 3. reescreve imports em todo arquivo, ja no seu local novo
  let tocados = 0
  for (const [arquivoAntigo, itens] of foto) {
    const local = renomeados.get(arquivoAntigo) ?? arquivoAntigo
    if (!existsSync(local)) continue
    const antes = readFileSync(local, 'utf8')
    const porSpec = new Map()
    for (const { spec, alvo } of itens) {
      const alvoNovo = renomeados.get(alvo) ?? alvo
      if (alvoNovo === alvo && local === arquivoAntigo) continue
      porSpec.set(spec, novoSpec(local, alvoNovo, spec))
    }
    if (!porSpec.size) continue
    const depois = antes.replace(ESPECIFICADOR, (todo, pre, aspas, spec) => {
      const novo = porSpec.get(spec)
      return novo ? `${pre}${aspas}${novo}${aspas}` : todo
    })
    if (depois !== antes) { writeFileSync(local, depois); tocados++ }
  }

  // 4. caminhos usados como DADO (string exata entre aspas) — ex: environment-contract.ts
  let dados = 0
  for (const arquivo of arquivosDeTexto()) {
    const antes = readFileSync(arquivo, 'utf8')
    let depois = antes
    for (const [o, d] of lote) {
      for (const q of ['"', "'", '`']) depois = depois.split(q + o + q).join(q + d + q)
    }
    if (depois !== antes) { writeFileSync(arquivo, depois); dados++ }
  }

  return { movidos: lote.length, tocados, dados }
}

// ---------- cli ----------

if (import.meta.main) {
  const argv = process.argv.slice(2)
  const aplicarDeVerdade = argv.includes('--aplicar')
  const filtro = (argv.find(a => a.startsWith('--dominio=')) ?? '').split('=')[1] || null

  const todos = expandir(lerMapaDoDoc())
  const erros = validar(todos)

  const porDominio = new Map()
  for (const [o, d] of todos) {
    const k = dominioDe(d)
    if (!porDominio.has(k)) porDominio.set(k, [])
    porDominio.get(k).push([o, d])
  }

  process.stdout.write(`mapa lido de ${DOC} §5: ${todos.length} arquivos\n`)
  for (const [k, v] of [...porDominio].sort((a, b) => b[1].length - a[1].length)) {
    process.stdout.write(`  ${k.padEnd(10)} ${String(v.length).padStart(3)}\n`)
  }

  if (erros.length) {
    process.stderr.write(`\n${erros.length} erro(s) de validacao:\n`)
    for (const e of erros.slice(0, 30)) process.stderr.write(`  ${e}\n`)
    process.exit(1)
  }
  process.stdout.write('validacao: ok (cobertura 100%, mapa injetivo, nenhum destino ocupado)\n')

  if (filtro && !porDominio.has(filtro)) {
    process.stderr.write(`dominio desconhecido: ${filtro}\n`)
    process.exit(1)
  }
  const lote = filtro ? porDominio.get(filtro) : todos

  if (!aplicarDeVerdade) {
    process.stdout.write(`\ndry-run — nada foi escrito. Lote: ${lote.length} arquivo(s)${filtro ? ` (dominio ${filtro})` : ''}.\n`)
    process.exit(0)
  }

  const r = aplicar(lote, true)
  process.stdout.write(`\naplicado: ${r.movidos} movido(s), ${r.tocados} arquivo(s) com import reescrito, ${r.dados} com caminho-dado atualizado.\n`)
}
