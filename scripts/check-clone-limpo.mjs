#!/usr/bin/env node
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname, resolve, relative, isAbsolute } from 'node:path'

const RAIZ = process.cwd()
const DIR_WORKFLOWS = join('.github', 'workflows')
const RE_SCRIPT_DE_RUN = /\b(?:bun|npm|pnpm|yarn)\s+run\s+([A-Za-z0-9:_.-]+)/g
const RE_CD_DE_RUN = /(?:^|[\s&|;])cd\s+([^\s&|;]+)/g
const RE_VIRGULA_SOBRANDO = /,(\s*[}\]])/g

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', cwd: RAIZ })
}

function caminhosRastreados() {
  return git(['ls-files']).split('\n').filter(Boolean)
}

function linksRastreados() {
  return git(['ls-files', '-s'])
    .split('\n')
    .filter(linha => linha.startsWith('120000 '))
    .map(linha => {
      const [meta, caminho] = linha.split('\t')
      return { sha: meta.split(' ')[1], caminho }
    })
}

function alvoDoLink(sha) {
  return git(['cat-file', 'blob', sha]).trim()
}

function saiDoClone(caminho, alvo) {
  if (isAbsolute(alvo)) return true
  return relative(RAIZ, resolve(RAIZ, dirname(caminho), alvo)).startsWith('..')
}

function linksQueNaoSobrevivemAoClone() {
  const achados = []
  for (const { sha, caminho } of linksRastreados()) {
    const alvo = alvoDoLink(sha)
    if (saiDoClone(caminho, alvo)) {
      achados.push(`${caminho} -> ${alvo}  (git rm --cached ${caminho} e ignore o caminho)`)
    }
  }
  return achados
}

function pacote() {
  return JSON.parse(readFileSync('package.json', 'utf8'))
}

function semVirgulaSobrando(texto) {
  return texto.replace(RE_VIRGULA_SOBRANDO, '$1')
}

function dependenciasDe(alvo) {
  return { ...(alvo.dependencies ?? {}), ...(alvo.devDependencies ?? {}) }
}

function lockForaDeSincronia() {
  if (!existsSync('bun.lock')) return []
  let lock
  // Lock ilegivel NAO e lock em dia. Devolver [] aqui fazia este lint imprimir
  // "ok (o repo sobrevive a um clone novo)" exatamente na falha que ele existe
  // para pegar — o clone novo quebraria e o gate teria dito que estava tudo bem.
  try { lock = JSON.parse(semVirgulaSobrando(readFileSync('bun.lock', 'utf8'))) } catch (e) {
    return [`bun.lock ilegivel (${e?.message || e}) — nao da para provar que o lock esta em dia; rode bun install e commite o lock`]
  }
  const declaradas = dependenciasDe(pacote())
  const travadas = dependenciasDe(lock.workspaces?.[''] ?? {})
  const achados = []
  for (const [nome, faixa] of Object.entries(declaradas)) {
    if (travadas[nome] !== faixa) achados.push(`bun.lock nao trava ${nome}@${faixa} — rode bun install e commite o lock`)
  }
  for (const nome of Object.keys(travadas)) {
    if (!(nome in declaradas)) achados.push(`bun.lock ainda trava ${nome}, que saiu do package.json`)
  }
  return achados
}

function arquivosDeWorkflow() {
  if (!existsSync(DIR_WORKFLOWS)) return []
  return readdirSync(DIR_WORKFLOWS)
    .filter(nome => nome.endsWith('.yml') || nome.endsWith('.yaml'))
    .map(nome => join(DIR_WORKFLOWS, nome))
}

function ehBlocoDeTexto(valor) {
  return valor === '|' || valor === '>' || valor === '|-' || valor === '>-'
}

function recuoDe(linha) {
  return linha.length - linha.trimStart().length
}

function comandosDeRun(texto) {
  const linhas = texto.split('\n')
  const comandos = []
  for (let i = 0; i < linhas.length; i++) {
    const marca = /^(\s*)-?\s*run:\s*(.*)$/.exec(linhas[i])
    if (!marca) continue
    const valor = marca[2].trim()
    if (!ehBlocoDeTexto(valor)) { comandos.push(valor); continue }
    for (let j = i + 1; j < linhas.length; j++) {
      if (!linhas[j].trim()) continue
      if (recuoDe(linhas[j]) <= marca[1].length) break
      comandos.push(linhas[j].trim())
    }
  }
  return comandos
}

function estaNoGit(alvo, rastreados) {
  const limpo = alvo.replace(/^\.\//, '').replace(/\/$/, '')
  return rastreados.some(caminho => caminho === limpo || caminho.startsWith(`${limpo}/`))
}

function referenciasQuebradasNaCi() {
  const scripts = new Set(Object.keys(pacote().scripts ?? {}))
  const rastreados = caminhosRastreados()
  const achados = []
  for (const arquivo of arquivosDeWorkflow()) {
    for (const comando of comandosDeRun(readFileSync(arquivo, 'utf8'))) {
      for (const achado of comando.matchAll(RE_SCRIPT_DE_RUN)) {
        if (!scripts.has(achado[1])) achados.push(`${arquivo}: chama "run ${achado[1]}", que nao existe em package.json`)
      }
      for (const achado of comando.matchAll(RE_CD_DE_RUN)) {
        if (!estaNoGit(achado[1], rastreados)) achados.push(`${arquivo}: faz "cd ${achado[1]}", que nao esta no git`)
      }
    }
  }
  return achados
}

const grupos = [
  ['link rastreado que morre fora desta maquina', linksQueNaoSobrevivemAoClone()],
  ['lockfile fora de sincronia com package.json', lockForaDeSincronia()],
  ['a CI chama o que nao existe no repo', referenciasQuebradasNaCi()],
]

let total = 0
for (const [titulo, achados] of grupos) {
  for (const achado of achados) {
    process.stdout.write(`${titulo}: ${achado}\n`)
    total++
  }
}

if (total) {
  process.stderr.write(`\nlint clone-limpo: ${total} problema(s) que passam aqui e quebram num clone limpo.\n`)
  process.exit(1)
}
process.stdout.write('lint clone-limpo: ok (o repo sobrevive a um clone novo)\n')
process.exit(0)
