import type { AgentRole, HarnessId } from './tipos'

export interface CatalogoDeModo {
  readonly modos: readonly string[]
  readonly padrao: string
}

const CATALOGO: Record<HarnessId, CatalogoDeModo> = {
  claude: { modos: ['default', 'acceptEdits', 'plan'], padrao: 'acceptEdits' },
  kimi: { modos: ['default', 'yolo', 'auto', 'plan'], padrao: 'auto' },
  codex: { modos: ['untrusted', 'on-request', 'never'], padrao: 'never' },
  ollama: { modos: [], padrao: '' },
}

export function modosDoProvedor(provedor: HarnessId): readonly string[] {
  return CATALOGO[provedor].modos
}

export function modoPadraoDoProvedor(provedor: HarnessId): string {
  return CATALOGO[provedor].padrao
}

export function temModos(provedor: HarnessId): boolean {
  return modosDoProvedor(provedor).length > 0
}

export function ehModoValido(provedor: HarnessId, modo: string | undefined): modo is string {
  return !!modo && modosDoProvedor(provedor).includes(modo)
}

export function modoResolvido(provedor: HarnessId, escolhido: string | undefined): string {
  return ehModoValido(provedor, escolhido) ? escolhido : modoPadraoDoProvedor(provedor)
}

const PAPEIS_QUE_EDITAM: readonly AgentRole[] = ['implement', 'step']

export function papelHonraModo(papel: AgentRole): boolean {
  return PAPEIS_QUE_EDITAM.includes(papel)
}
