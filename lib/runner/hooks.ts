import { existsSync, mkdirSync, copyFileSync, chmodSync, rmSync, readFileSync, renameSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const SUFIXO_DO_BACKUP = '.antes-do-hii'

export interface ResultadoDeInstalacao {
  ok: boolean
  caminho: string
  backup: string
  motivo: string
}

export interface ResultadoDeRemocao {
  ok: boolean
  restaurado: string
  motivo: string
}

function hooksDir(repo: string): string | null {
  const r = spawnSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: repo, encoding: 'utf8' })
  if (r.status !== 0) return null
  const rel = String(r.stdout || '').trim()
  if (!rel) return null
  return isAbsolute(rel) ? rel : join(repo, rel)
}

function conteudo(caminho: string): string {
  try {
    return readFileSync(caminho, 'utf8')
  } catch {
    return ''
  }
}

export function ehNossoHook(dest: string, source: string): boolean {
  return existsSync(dest) && conteudo(dest) === conteudo(source)
}

export function installPrePush(repo: string, source: string): ResultadoDeInstalacao {
  const vazio = { ok: false, caminho: '', backup: '', motivo: '' }
  if (!existsSync(source)) return { ...vazio, motivo: `hook de origem nao existe: ${source}` }
  const dir = hooksDir(repo)
  if (!dir) return { ...vazio, motivo: `${repo} nao parece um repo git` }
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const dest = join(dir, 'pre-push')

  let backup = ''
  if (existsSync(dest) && !ehNossoHook(dest, source)) {
    backup = dest + SUFIXO_DO_BACKUP
    if (existsSync(backup)) {
      return { ...vazio, caminho: dest, motivo: `ja existe um pre-push de outra ferramenta e o backup ${backup} tambem existe — resolva a mao antes` }
    }
    renameSync(dest, backup)
  }

  copyFileSync(source, dest)
  chmodSync(dest, 0o755)
  return { ok: true, caminho: dest, backup, motivo: '' }
}

export function uninstallPrePush(repo: string, source = ''): ResultadoDeRemocao {
  const dir = hooksDir(repo)
  if (!dir) return { ok: false, restaurado: '', motivo: `${repo} nao parece um repo git` }
  const dest = join(dir, 'pre-push')
  if (!existsSync(dest)) return { ok: false, restaurado: '', motivo: `nenhum pre-push encontrado em ${repo}` }
  if (source && !ehNossoHook(dest, source)) {
    return { ok: false, restaurado: '', motivo: `o pre-push de ${repo} nao foi instalado pelo hii — nao vou remover hook de outra ferramenta` }
  }

  rmSync(dest)
  const backup = dest + SUFIXO_DO_BACKUP
  if (!existsSync(backup)) return { ok: true, restaurado: '', motivo: '' }
  renameSync(backup, dest)
  chmodSync(dest, 0o755)
  return { ok: true, restaurado: dest, motivo: '' }
}
