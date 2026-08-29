import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_PROVIDER } from '../../tomada/registro.ts'
import { avisarArquivoIlegivel, motivoDoErro } from './aviso.ts'

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

Estas regras sao ADITIVAS ao CLAUDE.md do repositorio; nunca o substituem.
Escreva aqui, curto, o que o motor precisa saber deste projeto (stack, convencoes,
o que nunca mexer). Quanto mais curto, menos tokens por card.
`

export function initHicodeHome(repo: string): string[] {
  const home = hicodeHome(repo)
  const created: string[] = []
  const legacy = join(repo, '.hicode')
  if (!existsSync(home) && existsSync(legacy)) {
    renameSync(legacy, home)
    created.push(`${home} (migrado de .hicode/)`)
  }
  for (const d of [home, join(home, 'memory'), join(home, 'skills'), join(home, 'state')]) {
    if (!existsSync(d)) { mkdirSync(d, { recursive: true }); created.push(d) }
  }
  const files: Array<[string, string]> = [
    [join(home, 'config.json'), JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n'],
    [join(home, 'rules.md'), DEFAULT_RULES],
    [join(home, '.gitignore'), 'state/\ncontract.json\n'],
  ]
  for (const [f, content] of files) {
    if (!existsSync(f)) { writeFileSync(f, content); created.push(f) }
  }
  return created
}
