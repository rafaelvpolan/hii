import type { AgentRole, AiProviderName } from './types'

export interface CatalogoDeModo {
  readonly modos: readonly string[]
  readonly padrao: string
}

const CATALOGO: Record<AiProviderName, CatalogoDeModo> = {
  claude: { modos: ['default', 'acceptEdits', 'plan'], padrao: 'acceptEdits' },
  kimi: { modos: ['default', 'yolo', 'auto', 'plan'], padrao: 'auto' },
  codex: { modos: ['untrusted', 'on-request', 'never'], padrao: 'never' },
  ollama: { modos: [], padrao: '' },
}

export function modosDoProvedor(provedor: AiProviderName): readonly string[] {
  return CATALOGO[provedor].modos
}

export function modoPadraoDoProvedor(provedor: AiProviderName): string {
  return CATALOGO[provedor].padrao
}

export function temModos(provedor: AiProviderName): boolean {
  return modosDoProvedor(provedor).length > 0
}

export function ehModoValido(provedor: AiProviderName, modo: string | undefined): modo is string {
  return !!modo && modosDoProvedor(provedor).includes(modo)
}

export function modoResolvido(provedor: AiProviderName, escolhido: string | undefined): string {
  return ehModoValido(provedor, escolhido) ? escolhido : modoPadraoDoProvedor(provedor)
}

const PAPEIS_QUE_EDITAM: readonly AgentRole[] = ['implement', 'step']

export function papelHonraModo(papel: AgentRole): boolean {
  return PAPEIS_QUE_EDITAM.includes(papel)
}
