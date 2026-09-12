import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  detectBundler, detectDevPort, detectFramework, detectFrameworkPhp, detectLanguage,
  detectPackageManager, detectWorkspaceGlobs, expandGlobs, readPackageJson,
} from './detectar.ts'
import { readComposerJson, runtimesDoPacote } from './runtimes.ts'
import type { Commands, Contract, ContractSource, PackageInfo, PackageManager, RepoShape } from './tipos.ts'

const HASHED = ['package.json', 'pnpm-workspace.yaml', 'turbo.json', 'nx.json', 'bun.lock', 'pnpm-lock.yaml', 'yarn.lock', 'package-lock.json', 'tsconfig.json', '.codefox.yaml', 'composer.json', 'composer.lock', '.nvmrc', '.node-version', '.tool-versions', '.php-version']
const SKIP_DIRS = ['node_modules', 'docs', 'infra', 'dist', 'build', '.git', 'vendor']

function runner(pm: PackageManager): string {
  if (pm === 'composer') return 'composer run-script'
  return pm === 'npm' ? 'npm run' : `${pm} run`
}

function filterFlag(pm: PackageManager, pkg: string): string {
  if (!pkg) return ''
  if (pm === 'pnpm') return `pnpm --filter ${pkg} `
  if (pm === 'yarn') return `yarn workspace ${pkg} `
  if (pm === 'bun') return `bun --filter ${pkg} `
  if (pm === 'composer') return ''
  return `npm -w ${pkg} `
}

function pick(scripts: string[], names: string[]): string {
  return names.find(n => scripts.includes(n)) ?? ''
}

export function commandsFor(pm: PackageManager, scripts: string[], workspaceName = ''): Commands {
  const prefix = filterFlag(pm, workspaceName)
  const cmd = (script: string): string => {
    if (!script) return ''
    return prefix ? `${prefix}run ${script}` : `${runner(pm)} ${script}`
  }
  return {
    install: `${pm} install`,
    build: cmd(pick(scripts, ['build'])),
    test: cmd(pick(scripts, ['test', 'test:unit'])),
    lint: cmd(pick(scripts, ['lint'])),
    typecheck: cmd(pick(scripts, ['typecheck', 'type-check'])),
    dev: cmd(pick(scripts, ['dev', 'start', 'serve'])),
  }
}

// Comandos de um pacote PHP. `dev` usa {port}: `php artisan serve --port N` e
// `php -S host:N` nao aceitam a porta como flag no fim, e devCommand substitui.
export function commandsForPhp(dir: string, framework: string, scripts: readonly string[], requireDev: Record<string, string> | undefined): Commands {
  const script = (nome: string): string => (scripts.includes(nome) ? `composer run-script ${nome}` : '')
  const laravel = framework === 'Laravel'
  const temPhpunit = !!requireDev?.['phpunit/phpunit'] || existsSync(join(dir, 'vendor', 'bin', 'phpunit'))
  const temPhpstan = !!requireDev?.['phpstan/phpstan'] || !!requireDev?.['larastan/larastan']
  const dev = laravel
    ? 'php artisan serve --host 127.0.0.1 --port {port}'
    : existsSync(join(dir, 'public', 'index.php'))
      ? 'php -S 127.0.0.1:{port} -t public'
      : existsSync(join(dir, 'index.php')) ? 'php -S 127.0.0.1:{port}' : ''
  return {
    install: 'composer install',
    build: script('build'),
    test: script('test') || (laravel ? 'php artisan test' : temPhpunit ? 'vendor/bin/phpunit' : ''),
    lint: script('lint') || (requireDev?.['laravel/pint'] ? 'vendor/bin/pint --test' : requireDev?.['friendsofphp/php-cs-fixer'] ? 'vendor/bin/php-cs-fixer fix --dry-run' : ''),
    typecheck: script('typecheck') || script('analyse') || (temPhpstan ? 'vendor/bin/phpstan analyse' : ''),
    dev: script('dev') || dev,
  }
}

export function stackPhrase(main: PackageInfo | undefined, shape: RepoShape, total: number, bundler: string): string {
  if (!main) return 'stack nao detectado (sem package.json nem composer.json)'
  const parts = [bundler, main.framework, main.language].filter(Boolean)
  const base = parts.length ? parts.join(' + ') : 'stack nao detectado'
  if (shape === 'single') return `${base} (${main.packageManager})`
  const rotulo = shape === 'poly' ? 'poli-repo' : 'monorepo'
  return `${base} · ${rotulo} com ${total} projetos`
}

function inspectPhpPackage(root: string, rel: string): PackageInfo | null {
  const dir = rel ? join(root, rel) : root
  const composer = readComposerJson(dir)
  if (!composer) return null
  const scripts = Object.keys(composer.scripts ?? {})
  const framework = detectFrameworkPhp(composer.require)
  return {
    name: composer.name ?? basename(dir),
    path: rel,
    framework,
    language: 'PHP',
    packageManager: 'composer',
    scripts,
    devPort: 0,
    commands: commandsForPhp(dir, framework, scripts, composer['require-dev']),
    runtimes: runtimesDoPacote(root, rel),
  }
}

function inspectPackage(root: string, rel: string, workspacePm?: PackageManager, workspaceName = ''): PackageInfo | null {
  const dir = rel ? join(root, rel) : root
  const pkg = readPackageJson(dir)
  if (!pkg) return inspectPhpPackage(root, rel)
  const pm = workspacePm ?? detectPackageManager(dir)
  const scripts = Object.keys(pkg.scripts ?? {})
  return {
    name: pkg.name ?? basename(dir),
    path: rel,
    framework: detectFramework(pkg),
    language: detectLanguage(dir, pkg),
    packageManager: pm,
    scripts,
    devPort: detectDevPort(dir),
    commands: commandsFor(pm, scripts, workspaceName),
    runtimes: runtimesDoPacote(root, rel),
  }
}

function polyDirs(root: string): string[] {
  try {
    return readdirSync(root)
      .filter(d => !d.startsWith('.') && !SKIP_DIRS.includes(d))
      .filter(d => {
        try {
          return statSync(join(root, d)).isDirectory() && (existsSync(join(root, d, 'package.json')) || existsSync(join(root, d, 'composer.json')))
        } catch {
          return false
        }
      })
      .sort()
  } catch {
    return []
  }
}

function collect(root: string): { shape: RepoShape; packages: PackageInfo[] } {
  const rootPkg = readPackageJson(root)
  const globs = detectWorkspaceGlobs(root)
  if (globs.length) {
    const pm = detectPackageManager(root)
    const rels = expandGlobs(root, globs)
    const packages = [inspectPackage(root, '', pm), ...rels.map(r => inspectPackage(root, r, pm, readPackageJson(join(root, r))?.name ?? ''))]
      .filter((p): p is PackageInfo => p !== null)
    return { shape: 'workspaces', packages }
  }
  if (rootPkg || readComposerJson(root)) {
    const p = inspectPackage(root, '')
    return { shape: 'single', packages: p ? [p] : [] }
  }
  const packages = polyDirs(root)
    .map(d => inspectPackage(root, d))
    .filter((p): p is PackageInfo => p !== null)
  return { shape: packages.length ? 'poly' : 'single', packages }
}

function hashSources(root: string, packages: PackageInfo[]): { hash: string; sources: ContractSource[] } {
  const sources: ContractSource[] = []
  const all = createHash('sha256')
  const files = [...HASHED, ...packages.filter(p => p.path).flatMap(p => [`${p.path}/package.json`, `${p.path}/composer.json`, `${p.path}/.nvmrc`, `${p.path}/.tool-versions`])]
  for (const f of files) {
    const p = join(root, f)
    if (!existsSync(p)) continue
    const h = createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 12)
    sources.push({ kind: 'repo', ref: f, hash: h })
    all.update(`${f}:${h}`)
  }
  return { hash: all.digest('hex').slice(0, 16), sources }
}

export function probeContract(root: string, now: string): Contract {
  const { shape, packages } = collect(root)
  const main = packages.find(p => p.framework) ?? packages[0]
  const { hash, sources } = hashSources(root, packages)
  return {
    version: 1,
    generated: now,
    hash,
    shape,
    packageManager: main?.packageManager ?? detectPackageManager(root),
    monorepo: shape !== 'single',
    main: main?.path ?? '',
    packages,
    stack: stackPhrase(main, shape, packages.length, detectBundler(readPackageJson(main?.path ? join(root, main.path) : root))),
    commands: main?.commands ?? commandsFor(detectPackageManager(root), []),
    sources,
  }
}

export function packageForPath(contract: Contract, changed: string): PackageInfo | undefined {
  const candidatos = contract.packages
    .filter(p => p.path && changed.startsWith(`${p.path}/`))
    .sort((a, b) => b.path.length - a.path.length)
  return candidatos[0] ?? contract.packages.find(p => !p.path)
}
