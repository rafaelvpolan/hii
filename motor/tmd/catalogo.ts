import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../cdl/ali/config'
import { memoArquivo } from './eco/memo'
import { modelFor, providerNameFor, agentRoles } from './registro'
import type { HarnessId } from './tipos'

export type CatalogoDeModelos = Partial<Record<HarnessId, string[]>>

const SEMENTE: CatalogoDeModelos = {
  claude: ['opus', 'sonnet', 'haiku'],
  codex: [],
  ollama: [],
}

export function arquivoDoCatalogo(): string {
  return process.env.HICODE_MODELOS_FILE || join(ROOT, 'config', 'modelos.json')
}

function lerDoDisco(caminho: string): CatalogoDeModelos {
  if (!existsSync(caminho)) return {}
  try {
    const cru = JSON.parse(readFileSync(caminho, 'utf8')) as CatalogoDeModelos
    return cru && typeof cru === 'object' ? cru : {}
  } catch {
    return {}
  }
}

const lerMemorizado = memoArquivo(caminho => caminho, lerDoDisco)

export function catalogo(): CatalogoDeModelos {
  return lerMemorizado(arquivoDoCatalogo())
}

function emUso(provedor: HarnessId): string[] {
  const usados: string[] = []
  for (const papel of agentRoles()) {
    if (providerNameFor(papel) !== provedor) continue
    const m = modelFor(papel)
    if (m) usados.push(m)
  }
  return usados
}

export function modelosDe(provedor: HarnessId): string[] {
  const doArquivo = catalogo()[provedor] ?? []
  const daSemente = SEMENTE[provedor] ?? []
  const conhecidos = doArquivo.length ? doArquivo : daSemente
  return [...new Set([...conhecidos, ...emUso(provedor)])]
}

export function origemDoCatalogo(provedor: HarnessId): 'arquivo' | 'semente' | 'vazio' {
  if ((catalogo()[provedor] ?? []).length) return 'arquivo'
  if ((SEMENTE[provedor] ?? []).length) return 'semente'
  return 'vazio'
}
