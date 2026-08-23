import type { ConsumoDoProvedor } from '../../../euc/tsr/consumo'
import type { Situacao } from '../../../tmd/disponibilidade'


export interface JanelaDoPainel {
  rotulo: string
  percentualDoLimite: number | null
  limiteConfiavel: boolean
  gastoDoMotorUsd: number
  runsDoMotor: number
  restamMs: number
}

export interface LinhaDeProvedor {
  nome: string
  situacao: Situacao
  habilitado: boolean
  motivo: string
  plano: string
  planoLido: boolean
  rodaLocal: boolean
  detalheDoPlano: string
  janelas: JanelaDoPainel[]
  idadeDoUsoHoras: number
  modelosDisponiveis: string[]
  papeis: string[]
  modelo: string
  esforco: string
  restringeFerramenta: boolean
  isolaLeitura: boolean
  reportaCusto: boolean
}

export interface PapelDaSessao {
  rotulo: string
  provedor: string
  modelo: string
  custoUsd: number
  tokens: number
  chamadas: number
  falhas: number
}

export interface LedgerDaSessao {
  curto: string
  papeis: PapelDaSessao[]
  custoUsd: number
  tokens: number
}

export interface ItemDoLoop {
  id: string
  passo: string
  agente: string
  desde: string
}

export interface EstadoDaConfig {
  provedores: LinhaDeProvedor[]
  selecionado: string
  uso5h: ConsumoDoProvedor[]
  usoSemana: ConsumoDoProvedor[]
  serie: number[]
  loop: ItemDoLoop[]
  fila: number
  sessao: LedgerDaSessao
  gastoHoje: number
  tetoUsd: number
  projeto: string
}

export interface OpcoesConfig {
  color: boolean
  largura: number
  altura: number
}
