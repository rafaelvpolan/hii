import type { AgentResult, Harness } from '../../motor/tmd/tipos.ts'

export const ENV_TRILHA_CARA_HABILITADA = 'HICODE_E2E_MODELO_REAL'
export const ENV_TETO_DE_GASTO_USD = 'HICODE_E2E_TETO_USD'

function valorLigado(v: string | undefined): boolean {
  return v === '1' || v === 'true'
}

export function trilhaCaraHabilitada(env: NodeJS.ProcessEnv = process.env): boolean {
  return valorLigado(env[ENV_TRILHA_CARA_HABILITADA])
}

export function lerTetoDeGastoUsd(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const bruto = env[ENV_TETO_DE_GASTO_USD]
  if (bruto === undefined) return undefined
  const numero = Number(bruto)
  return Number.isFinite(numero) && numero > 0 ? numero : undefined
}

export function trilhaCaraDeveRodar(env: NodeJS.ProcessEnv = process.env): boolean {
  return trilhaCaraHabilitada(env) && lerTetoDeGastoUsd(env) !== undefined
}

export function gastaModelo(nomeDoTeste: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (trilhaCaraDeveRodar(env)) return true
  if (trilhaCaraHabilitada(env)) {
    process.stderr.write(`[e2e] "${nomeDoTeste}" gastaria modelo mas nao rodou: falta ${ENV_TETO_DE_GASTO_USD} — sem teto de gasto configurado a trilha cara nunca roda.\n`)
  }
  return false
}

export interface EvidenciaDaChamadaCara {
  readonly papel?: string
  readonly argv?: readonly string[]
  readonly saida?: string
  readonly resultado: AgentResult
}

export class CustoDaChamadaDesconhecido extends Error {
  constructor(detalheDaChamada: string) {
    super(`chamada real sem custo medido (costMeasured=false) — a trilha cara nunca assume gasto zero, recusando continuar. Se o provedor declara reportsCostUsd:false em capabilities(), o teto NAO consegue medi-lo: use exigirProvedorMensuravel() antes de gastar, em vez de descobrir isto no meio da rodada. detail: ${detalheDaChamada || '(vazio)'}`)
    this.name = 'CustoDaChamadaDesconhecido'
  }
}

export class ProvedorNaoMensuravel extends Error {
  constructor(nome: string) {
    super(`o provedor "${nome}" declara reportsCostUsd:false em capabilities() — ele nao devolve custo, entao o teto de ${ENV_TETO_DE_GASTO_USD} nao teria o que somar e a trilha cara gastaria sem limite real. Recusando abrir a rodada com ele.`)
    this.name = 'ProvedorNaoMensuravel'
  }
}

// Dois dos quatro harnesses (codex e kimi) espalham COST_UNKNOWN em toda resposta
// e ja declaram isso honestamente em capabilities().reportsCostUsd. Sem esta
// checagem, `registrarChamada` aborta na PRIMEIRA chamada deles — depois de a
// chamada ja ter sido paga. Perguntar antes custa uma leitura de capabilities e
// e a diferenca entre recusar de graca e recusar depois de gastar.
export function exigirProvedorMensuravel(harness: Harness): void {
  if (!harness.capabilities().reportsCostUsd) throw new ProvedorNaoMensuravel(harness.name)
}

function resumirEvidenciaParaMensagem(evidencia: EvidenciaDaChamadaCara, indice: number): string {
  const papel = evidencia.papel ? ` papel=${evidencia.papel}` : ''
  const argv = evidencia.argv ? ` argv=${JSON.stringify(evidencia.argv)}` : ''
  return `  #${indice + 1} custo=US$${evidencia.resultado.cost.toFixed(4)} tokens_in=${evidencia.resultado.usage.tokens_in} tokens_out=${evidencia.resultado.usage.tokens_out}${papel}${argv}`
}

export class TetoDeGastoEstourado extends Error {
  readonly gastoAcumuladoUsd: number
  readonly tetoUsd: number
  readonly evidenciasDaRodada: readonly EvidenciaDaChamadaCara[]

  constructor(gastoAcumuladoUsd: number, tetoUsd: number, evidenciasDaRodada: readonly EvidenciaDaChamadaCara[]) {
    const resumoDasChamadas = evidenciasDaRodada.map(resumirEvidenciaParaMensagem).join('\n')
    super([
      `teto de gasto da trilha cara estourado: acumulado US$${gastoAcumuladoUsd.toFixed(4)} > teto US$${tetoUsd.toFixed(4)} (${ENV_TETO_DE_GASTO_USD}).`,
      `evidencia das chamadas desta rodada, para reproduzir a falha:`,
      resumoDasChamadas,
      `se as chamadas passaram por test/apoio/cassete.ts, o AgentResult completo de cada uma esta gravado no arquivo de cassete correspondente.`,
    ].join('\n'))
    this.name = 'TetoDeGastoEstourado'
    this.gastoAcumuladoUsd = gastoAcumuladoUsd
    this.tetoUsd = tetoUsd
    this.evidenciasDaRodada = evidenciasDaRodada
  }
}

export interface RodadaCara {
  readonly gastoAcumuladoUsd: number
  registrarChamada(resultado: AgentResult, evidencia?: Omit<EvidenciaDaChamadaCara, 'resultado'>): void
  evidenciasDaRodada(): readonly EvidenciaDaChamadaCara[]
}

export function abrirRodadaCara(env: NodeJS.ProcessEnv = process.env): RodadaCara {
  const tetoUsd = lerTetoDeGastoUsd(env)
  if (tetoUsd === undefined) {
    throw new Error(`trilha cara sem teto configurado (${ENV_TETO_DE_GASTO_USD}) — recusando abrir a rodada.`)
  }
  let gastoAcumuladoUsd = 0
  const evidenciasDaRodada: EvidenciaDaChamadaCara[] = []
  return {
    get gastoAcumuladoUsd(): number {
      return gastoAcumuladoUsd
    },
    registrarChamada(resultado, evidencia) {
      if (!resultado.costMeasured) throw new CustoDaChamadaDesconhecido(resultado.detail)
      gastoAcumuladoUsd += resultado.cost
      evidenciasDaRodada.push({ ...evidencia, resultado })
      if (gastoAcumuladoUsd > tetoUsd) throw new TetoDeGastoEstourado(gastoAcumuladoUsd, tetoUsd, evidenciasDaRodada.slice())
    },
    evidenciasDaRodada: () => evidenciasDaRodada.slice(),
  }
}
