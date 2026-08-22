import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { providerNames, providerNameFor, modelFor, agentRoles } from './registry'
import { preferenciaDoPapel } from './preferencias'
import { autenticadoDoProvedor } from './planos'
import { janelasDoProvedor } from './janelas'
import type { AgentRole, AiProviderName } from './types'

const BINARIO: Partial<Record<AiProviderName, string>> = {
  claude: 'claude',
  codex: 'codex',
  kimi: 'kimi',
  ollama: 'ollama',
}

export const COMANDO_DE_LOGIN: Partial<Record<AiProviderName, string[]>> = {
  claude: ['claude', '/login'],
  codex: ['codex', 'login'],
  kimi: ['kimi', 'login'],
}

export type Situacao = 'disponivel' | 'ausente' | 'precisa-servidor' | 'nao-autenticado' | 'cota-esgotada'

export interface ProvedorDisponivel {
  nome: AiProviderName
  situacao: Situacao
  instalado: boolean
  comoObter: string
  modelo: string
  papeis: AgentRole[]
}

function noPath(binario: string): boolean {
  const caminhos = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  return caminhos.some(dir => existsSync(join(dir, binario)))
}

function cotaEsgotadaEm(nome: AiProviderName, agoraMs: number): boolean {
  return janelasDoProvedor(nome, agoraMs).some(j =>
    j.limiteConfiavel && j.percentualDoLimite !== null && j.percentualDoLimite >= 100 && j.restamMs > 0)
}

function situacaoDoInstalado(nome: AiProviderName, agoraMs: number): Situacao {
  if (!autenticadoDoProvedor(nome)) return 'nao-autenticado'
  if (cotaEsgotadaEm(nome, agoraMs)) return 'cota-esgotada'
  return 'disponivel'
}

function comandoDeLoginTexto(nome: AiProviderName): string {
  const partes = COMANDO_DE_LOGIN[nome]
  return partes ? partes.join(' ') : ''
}

function comoObter(nome: AiProviderName, situacao: Situacao): string {
  if (situacao === 'nao-autenticado') {
    const login = comandoDeLoginTexto(nome)
    return login ? `nao autenticado — rode \`${login}\` (ou /login aqui no hii)` : 'nao autenticado'
  }
  if (situacao === 'cota-esgotada') return 'cota da janela estourada — aguarde o reset ou troque de ia com /ia'
  if (nome === 'claude') return 'instale o CLI do Claude Code'
  if (nome === 'codex') return 'instale o CLI do Codex'
  if (nome === 'ollama') return `suba o ollama (${process.env.HICODE_OLLAMA_URL || 'http://localhost:11434'})`
  if (nome === 'kimi') return 'instale o CLI do Kimi Code'
  return ''
}

export function provedoresDisponiveis(agoraMs: number = Date.now()): ProvedorDisponivel[] {
  const papeisPorProvedor = new Map<string, AgentRole[]>()
  for (const papel of agentRoles()) {
    const p = providerNameFor(papel)
    papeisPorProvedor.set(p, [...(papeisPorProvedor.get(p) ?? []), papel])
  }
  return providerNames().map((nome): ProvedorDisponivel => {
    const bin = BINARIO[nome]
    const papeis = papeisPorProvedor.get(nome) ?? []
    const modeloDoPapel = papeis[0] ? modelFor(papeis[0]) : undefined
    const modeloEscolhido = papeis[0] ? preferenciaDoPapel(papeis[0]).model : undefined
    const situacao: Situacao = !bin
      ? 'precisa-servidor'
      : !noPath(bin) ? 'ausente' : situacaoDoInstalado(nome, agoraMs)
    return {
      nome,
      situacao,
      instalado: situacao !== 'ausente',
      comoObter: comoObter(nome, situacao),
      modelo: modeloEscolhido || modeloDoPapel || '',
      papeis,
    }
  })
}
