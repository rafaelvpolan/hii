import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { memoTempo } from '../core/cache'
import { stripAnsi } from '../core/tui/layout'
import type { Rgb } from '../core/tui/paleta'
import { ENV_CLAUDE_HOME_DIR, ENV_KIMI_HOME_DIR } from '../../motor/cdl/ali/contrato'
import { raizDoCodex } from './planos'
import { providerNameFor } from './registry'
import type { AiProviderName } from './types'

export interface ComandoDaIa {
  comando: string
  descricao: string
}

export interface ComandosDaIa {
  provedor: AiProviderName
  comandos: ComandoDaIa[]
}

const TTL_MS = 30_000

const CORES_DE_MARCA: Record<AiProviderName, Rgb> = {
  claude: { r: 218, g: 119, b: 86 },
  codex: { r: 16, g: 163, b: 127 },
  kimi: { r: 91, g: 141, b: 239 },
  ollama: { r: 148, g: 163, b: 184 },
}

export function corDaIa(nome: AiProviderName): Rgb {
  return CORES_DE_MARCA[nome]
}

function semAspas(valor: string): string {
  const t = valor.trim()
  if (t.length > 1 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
    return t.slice(1, -1)
  }
  return t
}

function sanitizarTextoDeRepoAlheio(valor: string): string {
  return stripAnsi(valor).replace(/[\r\n]+/g, ' ').replace(/[\x00-\x1f\x7f]/g, '').trim()
}

interface FrontMatter {
  nome: string
  descricao: string
}

function lerFrontMatter(caminho: string): FrontMatter | null {
  try {
    const texto = readFileSync(caminho, 'utf8')
    const m = texto.match(/^---\n([\s\S]*?)\n---/)
    if (!m) return null
    const campos = new Map<string, string>()
    for (const linha of (m[1] ?? '').split('\n')) {
      const i = linha.indexOf(':')
      if (i <= 0) continue
      campos.set(linha.slice(0, i).trim(), semAspas(linha.slice(i + 1)))
    }
    return {
      nome: sanitizarTextoDeRepoAlheio(campos.get('name') ?? ''),
      descricao: sanitizarTextoDeRepoAlheio(campos.get('description') ?? ''),
    }
  } catch {
    return null
  }
}

function comandosDeArquivos(dir: string): ComandoDaIa[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map((f): ComandoDaIa => ({
      comando: `/${sanitizarTextoDeRepoAlheio(f.replace(/\.md$/, ''))}`,
      descricao: lerFrontMatter(join(dir, f))?.descricao ?? '',
    }))
}

function comandosDeSkills(dir: string): ComandoDaIa[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(nome => existsSync(join(dir, nome, 'SKILL.md')))
    .map((nome): ComandoDaIa => {
      const fm = lerFrontMatter(join(dir, nome, 'SKILL.md'))
      return { comando: `/${fm?.nome || sanitizarTextoDeRepoAlheio(nome)}`, descricao: fm?.descricao ?? '' }
    })
}

function raizDoClaude(): string {
  return process.env[ENV_CLAUDE_HOME_DIR] || join(homedir(), '.claude')
}

function raizDoKimi(): string {
  return process.env[ENV_KIMI_HOME_DIR] || join(homedir(), '.kimi-code')
}

type Fonte = (repoPath: string) => ComandoDaIa[]

const FONTES: Partial<Record<AiProviderName, Fonte[]>> = {
  claude: [
    () => comandosDeArquivos(join(raizDoClaude(), 'commands')),
    repoPath => repoPath ? comandosDeArquivos(join(repoPath, '.claude', 'commands')) : [],
    repoPath => repoPath ? comandosDeSkills(join(repoPath, '.claude', 'skills')) : [],
  ],
  codex: [
    () => comandosDeSkills(join(raizDoCodex(), 'skills')),
    repoPath => repoPath ? comandosDeSkills(join(repoPath, '.codex', 'skills')) : [],
  ],
  kimi: [
    () => comandosDeSkills(join(raizDoKimi(), 'skills')),
    repoPath => repoPath ? comandosDeSkills(join(repoPath, '.kimi-code', 'skills')) : [],
  ],
}

function descobrirComandos(provedor: AiProviderName, repoPath: string): ComandoDaIa[] {
  const vistos = new Set<string>()
  const out: ComandoDaIa[] = []
  for (const fonte of FONTES[provedor] ?? []) {
    for (const c of fonte(repoPath)) {
      if (c.comando === '/' || vistos.has(c.comando)) continue
      vistos.add(c.comando)
      out.push(c)
    }
  }
  return out
}

const memorizadoPorChave = new Map<string, () => ComandoDaIa[]>()

function memorizadoDe(provedor: AiProviderName, repoPath: string): () => ComandoDaIa[] {
  const chave = `${provedor}::${repoPath}`
  const existente = memorizadoPorChave.get(chave)
  if (existente) return existente
  const memo = memoTempo(() => descobrirComandos(provedor, repoPath), TTL_MS)
  memorizadoPorChave.set(chave, memo)
  return memo
}

export function comandosDaIaAtiva(repoPath: string): ComandosDaIa {
  const provedor = providerNameFor('implement')
  return { provedor, comandos: memorizadoDe(provedor, repoPath)() }
}
