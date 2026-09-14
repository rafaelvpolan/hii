import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { memoTempo } from '../eco/memo.ts'
import { stripAnsi } from '../../mirante/tui/layout.ts'
import type { Rgb } from '../../mirante/tui/paleta.ts'
import { ENV_CLAUDE_HOME_DIR, ENV_KIMI_HOME_DIR } from '../../cordel/alicerce/contrato.ts'
import { raizDoCodex } from '../../euclides/tesouro/planos.ts'
import { providerNameFor } from '../registro.ts'
import { corDoHarness } from '../registro.ts'
import type { HarnessId } from '../tipos.ts'

export interface ComandoDaIa {
  comando: string
  descricao: string
  origem?: 'ia' | 'orquestrador'
  instrucoes?: string
}

export interface ComandosDaIa {
  provedor: HarnessId
  comandos: ComandoDaIa[]
}

const TTL_MS = 30_000

export function corDaIa(nome: HarnessId): Rgb {
  return corDoHarness(nome)
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
  instrucoes: string
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
      instrucoes: stripAnsi(texto.slice((m.index ?? 0) + m[0].length))
        .replace(/\r/g, '')
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
        .trim(),
    }
  } catch {
    return null
  }
}

function comandosDeArquivos(dir: string): ComandoDaIa[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map((f): ComandoDaIa => {
      const fm = lerFrontMatter(join(dir, f))
      return {
        comando: `/${sanitizarTextoDeRepoAlheio(f.replace(/\.md$/, ''))}`,
        descricao: fm?.descricao ?? '',
        instrucoes: fm?.instrucoes ?? '',
      }
    })
}

function comandosDeSkills(dir: string): ComandoDaIa[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(nome => existsSync(join(dir, nome, 'SKILL.md')))
    .map((nome): ComandoDaIa => {
      const fm = lerFrontMatter(join(dir, nome, 'SKILL.md'))
      return {
        comando: `/${fm?.nome || sanitizarTextoDeRepoAlheio(nome)}`,
        descricao: fm?.descricao ?? '',
        instrucoes: fm?.instrucoes ?? '',
      }
    })
}

function subdiretorios(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(entrada => entrada.isDirectory())
      .map(entrada => join(dir, entrada.name))
  } catch {
    return []
  }
}

// Plugins Codex instalados ficam no cache em marketplace/plugin/versao/commands.
// As skills ja eram lidas de CODEX_HOME/skills, mas os comandos do ECC moram
// nesta arvore e por isso ficavam invisiveis para autocomplete e para o despacho.
function comandosDePluginsDoCodex(): ComandoDaIa[] {
  const cache = join(raizDoCodex(), 'plugins', 'cache')
  return subdiretorios(cache)
    .flatMap(marketplace => subdiretorios(marketplace))
    .flatMap(plugin => subdiretorios(plugin))
    .flatMap(versao => comandosDeArquivos(join(versao, 'commands')))
}

function skillsDePluginsDoCodex(): ComandoDaIa[] {
  const cache = join(raizDoCodex(), 'plugins', 'cache')
  return subdiretorios(cache)
    .flatMap(marketplace => subdiretorios(marketplace))
    .flatMap(plugin => subdiretorios(plugin))
    .flatMap(versao => comandosDeSkills(join(versao, 'skills')))
}

function raizDoClaude(): string {
  return process.env[ENV_CLAUDE_HOME_DIR] || join(homedir(), '.claude')
}

function raizDoKimi(): string {
  return process.env[ENV_KIMI_HOME_DIR] || join(homedir(), '.kimi-code')
}

type Fonte = (repoPath: string) => ComandoDaIa[]

const NOMES_DO_ORQUESTRADOR = new Set(['nexus', 'codefox'])

function comandosDoOrquestrador(repoPath: string): ComandoDaIa[] {
  const fontes = [
    repoPath ? comandosDeSkills(join(repoPath, '.claude', 'skills')) : [],
    comandosDeSkills(join(raizDoClaude(), 'skills')),
  ]
  const vistos = new Set<string>()
  return fontes.flat()
    .filter(c => NOMES_DO_ORQUESTRADOR.has(c.comando.slice(1)))
    .filter(c => {
      if (vistos.has(c.comando)) return false
      vistos.add(c.comando)
      return true
    })
    .map(c => ({ ...c, origem: 'orquestrador' as const }))
}

const FONTES: Partial<Record<HarnessId, Fonte[]>> = {
  claude: [
    () => comandosDeArquivos(join(raizDoClaude(), 'commands')),
    repoPath => repoPath ? comandosDeArquivos(join(repoPath, '.claude', 'commands')) : [],
    repoPath => repoPath ? comandosDeSkills(join(repoPath, '.claude', 'skills')) : [],
  ],
  codex: [
    () => comandosDePluginsDoCodex(),
    () => skillsDePluginsDoCodex(),
    () => comandosDeSkills(join(raizDoCodex(), 'skills')),
    repoPath => repoPath ? comandosDeSkills(join(repoPath, '.codex', 'skills')) : [],
  ],
  kimi: [
    () => comandosDeSkills(join(raizDoKimi(), 'skills')),
    repoPath => repoPath ? comandosDeSkills(join(repoPath, '.kimi-code', 'skills')) : [],
  ],
}

function descobrirComandos(provedor: HarnessId, repoPath: string): ComandoDaIa[] {
  const vistos = new Set<string>()
  const out: ComandoDaIa[] = []
  for (const c of comandosDoOrquestrador(repoPath)) {
    vistos.add(c.comando)
    out.push(c)
  }
  for (const fonte of FONTES[provedor] ?? []) {
    for (const c of fonte(repoPath)) {
      if (c.comando === '/' || vistos.has(c.comando)) continue
      vistos.add(c.comando)
      out.push({ ...c, origem: c.origem ?? 'ia' })
    }
  }
  return out
}

const memorizadoPorChave = new Map<string, () => ComandoDaIa[]>()

function memorizadoDe(provedor: HarnessId, repoPath: string): () => ComandoDaIa[] {
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

// O slash digitado no card e a referencia ao recurso; o conteúdo precisa entrar
// no prompt para harnesses que nao carregam skills do Claude/Codex por conta propria
// (em especial o Codex executado pelo HII). Somente comandos explicitamente pedidos
// sao expandidos, para nao despejar centenas de skills externas em toda tarefa.
export function instrucoesDosComandos(texto: string, repoPath: string): string {
  const pedidos = [...new Set(texto.match(/\/[a-z0-9][a-z0-9:-]*/gi) ?? [])]
  if (!pedidos.length) return ''
  const porNome = new Map(comandosDaIaAtiva(repoPath).comandos.map(c => [c.comando.toLowerCase(), c]))
  const encontrados = pedidos
    .map(pedido => porNome.get(pedido.toLowerCase()))
    .filter((c): c is ComandoDaIa => !!c && !!c.instrucoes)
  if (!encontrados.length) return ''
  return [
    `RECURSOS EXPLICITAMENTE SOLICITADOS (${encontrados.length}):`,
    ...encontrados.map(c => [
      `### ${c.comando} (${c.origem === 'orquestrador' ? 'orquestrador do HII' : 'skill/comando da IA'})`,
      c.instrucoes ?? '',
      'O ciclo de vida do HII e a politica de escrita do prompt continuam valendo. Nao inicie outro motor, Workflow ou Task externo; aplique este conhecimento nesta execucao e neste projeto-alvo.',
    ].join('\n')),
  ].join('\n\n')
}
