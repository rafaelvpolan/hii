import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LinguagemDeRuntime, RuntimeDeclarado } from './tipos.ts'
import { readPackageJson } from './detectar.ts'

// Bussola — que versao de Node e de PHP cada pacote declara. Num monolito modular
// (web em Node 18, api em PHP 8.2, legado em Node 16) a versao e parte do contrato
// do pacote, e e ela que decide sob qual runtime o motor roda build, teste e dev —
// senao dois worktrees em paralelo disputam o `nvm use` global e um deles quebra.

export interface ComposerJson {
  name?: string
  require?: Record<string, string>
  'require-dev'?: Record<string, string>
  scripts?: Record<string, string | string[]>
  config?: { platform?: Record<string, string> }
}

export function readComposerJson(dir: string): ComposerJson | null {
  const f = join(dir, 'composer.json')
  if (!existsSync(f)) return null
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as ComposerJson
  } catch {
    return null
  }
}

function ler(caminho: string): string {
  try { return readFileSync(caminho, 'utf8') } catch { return '' }
}

// "^8.2", ">=18 <21", "v20.11.0", "lts/*", "18.x" -> a primeira versao numerica que
// da para pedir a um gerente. Apelidos (lts/*, latest) passam intactos: mise e nvm
// entendem; o doctor avisa se o gerente do host nao entender.
export function normalizarVersao(bruta: string): string {
  const t = bruta.trim().replace(/^v/i, '')
  if (!t) return ''
  if (/^(lts\/|latest|system)/i.test(t)) return t
  const m = t.match(/\d+(?:\.\d+){0,2}/)
  return m ? m[0] : ''
}

function toolVersions(dir: string): RuntimeDeclarado[] {
  const out: RuntimeDeclarado[] = []
  for (const linha of ler(join(dir, '.tool-versions')).split('\n')) {
    const [nome, versao] = linha.replace(/#.*$/, '').trim().split(/\s+/)
    if (!nome || !versao) continue
    if (nome === 'nodejs' || nome === 'node') out.push({ linguagem: 'node', versao: normalizarVersao(versao), fonte: '.tool-versions' })
    if (nome === 'php') out.push({ linguagem: 'php', versao: normalizarVersao(versao), fonte: '.tool-versions' })
  }
  return out
}

function primeiroPorLinguagem(candidatos: RuntimeDeclarado[]): RuntimeDeclarado[] {
  const vistos = new Set<LinguagemDeRuntime>()
  return candidatos.filter(c => {
    if (!c.versao || vistos.has(c.linguagem)) return false
    vistos.add(c.linguagem)
    return true
  })
}

export function detectRuntimes(dir: string): RuntimeDeclarado[] {
  const pkg = readPackageJson(dir) as { engines?: { node?: string } } | null
  const composer = readComposerJson(dir)
  const candidatos: RuntimeDeclarado[] = [
    { linguagem: 'node', versao: normalizarVersao(ler(join(dir, '.nvmrc'))), fonte: '.nvmrc' },
    { linguagem: 'node', versao: normalizarVersao(ler(join(dir, '.node-version'))), fonte: '.node-version' },
    ...toolVersions(dir),
    { linguagem: 'node', versao: normalizarVersao(pkg?.engines?.node ?? ''), fonte: 'package.json#engines.node' },
    { linguagem: 'php', versao: normalizarVersao(ler(join(dir, '.php-version'))), fonte: '.php-version' },
    { linguagem: 'php', versao: normalizarVersao(composer?.config?.platform?.php ?? ''), fonte: 'composer.json#config.platform.php' },
    { linguagem: 'php', versao: normalizarVersao(composer?.require?.php ?? ''), fonte: 'composer.json#require.php' },
  ]
  return primeiroPorLinguagem(candidatos)
}

// O pacote herda do raiz o que nao declara: num monolito com .tool-versions na
// raiz e composer.json em api/, a api roda no PHP da raiz e o web no Node da raiz.
export function runtimesDoPacote(root: string, rel: string): RuntimeDeclarado[] {
  const proprios = detectRuntimes(rel ? join(root, rel) : root)
  if (!rel) return proprios
  const herdados = detectRuntimes(root).filter(h => !proprios.some(p => p.linguagem === h.linguagem)).map(h => ({ ...h, fonte: `raiz/${h.fonte}` }))
  return [...proprios, ...herdados]
}

export function descreverRuntimes(runtimes: readonly RuntimeDeclarado[] | undefined): string {
  return (runtimes ?? []).map(r => `${r.linguagem} ${r.versao}`).join(' · ')
}
