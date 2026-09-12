import { join } from 'node:path'
import { packageForPath } from '../cordel/bussola/sondar.ts'
import type { Contract, PackageInfo } from '../cordel/bussola/tipos.ts'
import { envolverComRuntime } from '../quilombo/gerente-de-versao.ts'
import type { GerentesDoHost } from '../quilombo/gerente-de-versao.ts'

export type CommandKind = 'build' | 'test' | 'lint' | 'typecheck' | 'dev'

export interface ResolvedCommand {
  cmd: string
  args: string[]
  cwd: string
  label: string
  // Variaveis que o gerente de versao pede (ASDF_NODEJS_VERSION, PHPENV_VERSION…).
  env: Record<string, string>
  // "node 18 via mise · php 8.2 via mise", ou '' quando o pacote nao declara versao.
  runtime: string
  avisosDeRuntime: string[]
}

export function splitCommand(command: string): { cmd: string; args: string[] } | null {
  const parts = command.trim().split(/\s+/).filter(Boolean)
  const head = parts[0]
  if (!head) return null
  return { cmd: head, args: parts.slice(1) }
}

export function affectedPackage(contract: Contract, changed: string[]): PackageInfo | undefined {
  const hits = new Map<string, PackageInfo>()
  for (const file of changed) {
    const pkg = packageForPath(contract, file)
    if (pkg) hits.set(pkg.path, pkg)
  }
  if (hits.size !== 1) return undefined
  return [...hits.values()][0]
}

function pickPackage(contract: Contract, pkg: PackageInfo | undefined): PackageInfo | undefined {
  if (pkg) return pkg
  return contract.packages.find(p => p.path === contract.main) ?? contract.packages[0]
}

export function resolveCommand(contract: Contract, kind: CommandKind, worktree: string, pkg?: PackageInfo, gerentes?: GerentesDoHost): ResolvedCommand | null {
  const alvo = pickPackage(contract, pkg)
  const raw = pkg ? pkg.commands[kind] : (alvo?.commands[kind] ?? contract.commands[kind])
  const parsed = splitCommand(raw)
  if (!parsed) return null
  const scoped = contract.shape === 'poly' && alvo?.path ? join(worktree, alvo.path) : worktree
  const envolvido = envolverComRuntime(parsed.cmd, parsed.args, alvo?.runtimes, gerentes)
  return { cmd: envolvido.cmd, args: envolvido.args, cwd: scoped, label: raw, env: envolvido.env, runtime: envolvido.rotulo, avisosDeRuntime: envolvido.avisos }
}

const PORT_FLAG: Record<string, string> = {
  'Next.js': '-p',
  Nuxt: '--port',
  Astro: '--port',
  Remix: '--port',
}

export function devCommand(contract: Contract, port: number, pkg?: PackageInfo, gerentes?: GerentesDoHost): ResolvedCommand | null {
  const base = resolveCommand(contract, 'dev', '', pkg, gerentes)
  if (!base) return null
  // `{port}` no comando (php artisan serve --port {port}, php -S host:{port}) e
  // substituido onde esta; sem o marcador, a porta vai como flag no fim.
  if (base.label.includes('{port}')) {
    const troca = (s: string): string => s.replaceAll('{port}', String(port))
    return { ...base, cmd: troca(base.cmd), args: base.args.map(troca), label: troca(base.label) }
  }
  const alvo = pickPackage(contract, pkg)
  const flag = PORT_FLAG[alvo?.framework ?? ''] ?? '--port'
  const separador = base.cmd === 'npm' ? ['--'] : []
  return { ...base, args: [...base.args, ...separador, flag, String(port)] }
}

export function devCwd(contract: Contract, worktree: string, pkg?: PackageInfo): string {
  const alvo = pickPackage(contract, pkg)
  return contract.shape === 'poly' && alvo?.path ? join(worktree, alvo.path) : worktree
}

export function hasCommand(contract: Contract | null, kind: CommandKind): boolean {
  if (!contract) return false
  if (contract.commands[kind]) return true
  return contract.packages.some(p => p.commands[kind])
}
