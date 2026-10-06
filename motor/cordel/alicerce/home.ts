import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_PROVIDER } from '../../tomada/registro.ts'
import { avisarArquivoIlegivel, motivoDoErro } from './aviso.ts'
import { diretoriosPorIa, leiaMePorIa, temLinkNoDestino } from './pastas-por-ia.ts'

export interface ProjectConfig {
  provider?: string
  base?: string
  taskSource?: string
}

// O sinal de ilegibilidade vive FORA do tipo de dados. Como campo `ilegivel` dentro
// de ProjectConfig ele morava no mesmo namespace das chaves de verdade: um
// `.hii/config.json` legitimo contendo `"ilegivel": true` faria o doctor reportar
// "nao deu para ler" sobre um JSON perfeitamente valido.
export interface LeituraDeProjectConfig {
  readonly config: ProjectConfig
  // '' = leu (ou o arquivo nao existe). Preenchido = existe e nao deu para ler.
  readonly ilegivel: string
}

export function hicodeHome(repo: string): string {
  return join(repo, '.hii')
}

const IGNORADAS = 'as preferencias declaradas pelo projeto serao ignoradas'

export function lerProjectConfig(repo: string): LeituraDeProjectConfig {
  const f = join(hicodeHome(repo), 'config.json')
  if (!existsSync(f)) return { config: {}, ilegivel: '' }
  let cru: ProjectConfig | null = null
  try {
    cru = JSON.parse(readFileSync(f, 'utf8')) as ProjectConfig | null
  } catch (e) {
    // Corrompido devolvia `{}`, igual a ausente, e o `hii doctor` respondia "sem
    // preferencia declarada — vale o global" sobre um arquivo que o operador
    // escreveu.
    const motivo = motivoDoErro(e as Error)
    avisarArquivoIlegivel(f, motivo, IGNORADAS)
    return { config: {}, ilegivel: motivo }
  }
  if (!cru || typeof cru !== 'object' || Array.isArray(cru)) {
    const motivo = 'o conteudo nao e um objeto de configuracao'
    avisarArquivoIlegivel(f, motivo, IGNORADAS)
    return { config: {}, ilegivel: motivo }
  }
  return { config: cru, ilegivel: '' }
}

export function readProjectConfig(repo: string): ProjectConfig {
  return lerProjectConfig(repo).config
}

export function readProjectRules(repo: string): string {
  const f = join(hicodeHome(repo), 'rules.md')
  if (!existsSync(f)) return ''
  try {
    return readFileSync(f, 'utf8').trim().slice(0, 4000)
  } catch {
    return ''
  }
}

const DEFAULT_CONFIG: ProjectConfig = { provider: DEFAULT_PROVIDER, base: 'main', taskSource: 'cards' }

const DEFAULT_RULES = `# Regras do projeto para o motor hicode

Estas regras sao a fonte para qualquer IA: o motor as injeta no prompt e
\`hii projetar\` as leva ao padrao nativo de cada IA (CLAUDE.md, AGENTS.md).
Escreva aqui, curto, o que o motor precisa saber deste projeto (stack, convencoes,
o que nunca mexer). Quanto mais curto, menos tokens por card.
`

export function initHicodeHome(repo: string): string[] {
  const home = hicodeHome(repo)
  const created: string[] = []
  if (temLinkNoDestino(repo, home)) throw new Error('.hii deve ser uma pasta propria do projeto, sem links simbolicos')
  const legacy = join(repo, '.hicode')
  if (!existsSync(home) && existsSync(legacy) && temLinkNoDestino(repo, legacy)) throw new Error('.hicode legado nao pode ser um link simbolico para migracao')
  if (!existsSync(home) && existsSync(legacy)) {
    renameSync(legacy, home)
    created.push(`${home} (migrado de .hicode/)`)
  }
  for (const d of [home, join(home, 'memory'), join(home, 'skills'), join(home, 'state'), ...diretoriosPorIa(home)]) {
    if (temLinkNoDestino(repo, d)) throw new Error('pasta do projeto nao pode ser link simbolico: ' + d)
    if (!existsSync(d)) { mkdirSync(d, { recursive: true }); created.push(d) }
  }
  const files = [...arquivosIniciaisDoHome().map(([nome, conteudo]) => [join(home, nome), conteudo] as [string, string]), ...leiaMePorIa(home)]
  for (const [f, content] of files) {
    if (temLinkNoDestino(repo, f)) throw new Error('arquivo gerenciado do projeto nao pode ser link simbolico: ' + f)
    if (!existsSync(f)) { writeFileSync(f, content); created.push(f) }
    else if (f === join(home, '.gitignore') && completarIgnorados(f, content)) created.push(`${f} (regras novas)`)
  }
  return created
}

function completarIgnorados(arquivo: string, esperado: string): boolean {
  const atual = readFileSync(arquivo, 'utf8')
  const presentes = new Set(atual.split(/\r?\n/).map(l => l.trim()))
  const faltando = esperado.split('\n').filter(l => l && !presentes.has(l))
  if (!faltando.length) return false
  writeFileSync(arquivo, `${atual}${atual.endsWith('\n') || !atual ? '' : '\n'}${faltando.join('\n')}\n`)
  return true
}

export function arquivosIniciaisDoHome(): Array<[string, string]> {
  return [['config.json', JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n'], ['rules.md', DEFAULT_RULES], ['memory/LEIA-ME.md', '# Memoria duravel do projeto\n\nRegistre decisoes, convencoes e aprendizados confirmados. Nao inclua credenciais nem logs de execucao. Esta memoria e compartilhada entre as IAs.\n'], ['.gitignore', 'state/\ncontract.json\nia/*/executions/\n']]
}
