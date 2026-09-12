export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'composer'

export type LinguagemDeRuntime = 'node' | 'php'

export interface RuntimeDeclarado {
  linguagem: LinguagemDeRuntime
  versao: string
  fonte: string
}

export type RepoShape = 'single' | 'workspaces' | 'poly'

export interface PackageInfo {
  name: string
  path: string
  framework: string
  language: string
  packageManager: PackageManager
  scripts: string[]
  devPort: number
  commands: Commands
  // Versoes de runtime que o pacote declara (.nvmrc, engines.node, .tool-versions,
  // composer.json#require.php, .php-version). Ausente em contrato antigo = nenhuma.
  runtimes?: RuntimeDeclarado[]
}

export interface Commands {
  install: string
  build: string
  test: string
  lint: string
  typecheck: string
  dev: string
}

export interface ContractSource {
  kind: 'repo'
  ref: string
  hash: string
}

export interface Contract {
  version: 1
  generated: string
  hash: string
  shape: RepoShape
  packageManager: PackageManager
  monorepo: boolean
  main: string
  packages: PackageInfo[]
  stack: string
  commands: Commands
  sources: ContractSource[]
}
