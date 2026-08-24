import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { agentRoles, binarioDoHarness, comandoDeLoginDe, harnessPorNome, modelFor, providerNameFor, providerNames } from './registro.ts'
import { preferenciaDoPapel } from './preferencias.ts'
import { janelasDoProvedor } from '../euc/tsr/janelas.ts'
import type { AgentRole, HarnessId } from './tipos.ts'

export function comandoDeLoginDoProvedor(nome: HarnessId): readonly string[] {
  return comandoDeLoginDe(nome)
}

export type Situacao = 'disponivel' | 'ausente' | 'precisa-servidor' | 'nao-autenticado' | 'cota-esgotada'

export interface ProvedorDisponivel {
  nome: HarnessId
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

function cotaEsgotadaEm(nome: HarnessId, agoraMs: number): boolean {
  return janelasDoProvedor(nome, agoraMs).some(j =>
    j.limiteConfiavel && j.percentualDoLimite !== null && j.percentualDoLimite >= 100 && j.restamMs > 0)
}

function situacaoDoInstalado(nome: HarnessId, agoraMs: number): Situacao {
  if (!harnessPorNome(nome).autenticado()) return 'nao-autenticado'
  if (cotaEsgotadaEm(nome, agoraMs)) return 'cota-esgotada'
  return 'disponivel'
}

function comandoDeLoginTexto(nome: HarnessId): string {
  return comandoDeLoginDe(nome).join(' ')
}

function comoObter(nome: HarnessId, situacao: Situacao): string {
  if (situacao === 'nao-autenticado') {
    const login = comandoDeLoginTexto(nome)
    return login ? `nao autenticado — rode \`${login}\` (ou /login aqui no hii)` : 'nao autenticado'
  }
  if (situacao === 'cota-esgotada') return 'cota da janela estourada — aguarde o reset ou troque de ia com /ia'
  return harnessPorNome(nome).comoObterQuandoAusente()
}

export function provedoresDisponiveis(agoraMs: number = Date.now()): ProvedorDisponivel[] {
  const papeisPorProvedor = new Map<string, AgentRole[]>()
  for (const papel of agentRoles()) {
    const p = providerNameFor(papel)
    papeisPorProvedor.set(p, [...(papeisPorProvedor.get(p) ?? []), papel])
  }
  return providerNames().map((nome): ProvedorDisponivel => {
    const bin = binarioDoHarness(nome)
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
