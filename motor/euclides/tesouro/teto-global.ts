// Tesouro — teto GLOBAL de gasto, por janela movel. O teto por card limita cada
// tarefa; N cards em voo custavam N x teto sem freio agregado, e OPERACAO.md
// prometia um HII_BUDGET_USD que nenhuma linha lia — doc de rede de protecao
// que nao existia. Aqui a variavel passa a valer de verdade.
//
// Barra no DESPACHO (tick), nunca no meio de um card: derrubar chamada em voo
// desperdicaria trabalho ja pago. Job em andamento termina, nenhum status muda,
// e o bloqueio se desfaz sozinho quando o run mais antigo sai da janela.
//
// Governanca ilegivel e fail-open COM aviso: matar todo tick por um arquivo de
// config seria pior que ficar sem o teto — mas ficar sem o teto em silencio
// seria o defeito original de novo, entao o aviso diz a consequencia.
import { numeroDeEnv } from '../../cordel/alicerce/config.ts'
import { avisarArquivoIlegivel, motivoDoErro } from '../../cordel/alicerce/aviso.ts'
import { arquivoDeGovernanca, lerGovernanca } from './orcamento.ts'
import type { Governanca } from './orcamento.ts'
import { duracaoDaJanela } from './janelas.ts'
import { loteDesde } from './cota-runs.ts'
import type { RegistroDeRun } from './cota-runs.ts'

const JANELA_PADRAO = '24h'

export type OrigemDoTeto = 'env' | 'arquivo' | 'desligado'

export interface TetoGlobal {
  tetoUsd: number
  janelaMs: number
  origem: OrigemDoTeto
}

function governancaSemDerrubar(): Governanca | null {
  try {
    return lerGovernanca()
  } catch (e) {
    avisarArquivoIlegivel(arquivoDeGovernanca(), motivoDoErro(e as Error), 'o teto GLOBAL de gasto NAO esta sendo aplicado — conserte o arquivo; o teto por card tem a propria guarda e continua')
    return null
  }
}

export function tetoGlobal(g?: Governanca): TetoGlobal {
  const gov = g === undefined ? governancaSemDerrubar() : g
  const janelaConfigurada = gov?.orcamentoGlobal?.janela ?? JANELA_PADRAO
  const janelaMs = duracaoDaJanela(janelaConfigurada) || duracaoDaJanela(JANELA_PADRAO)
  const daEnv = numeroDeEnv('HII_BUDGET_USD', 0)
  if (daEnv > 0) return { tetoUsd: daEnv, janelaMs, origem: 'env' }
  const doArquivo = gov?.orcamentoGlobal?.tetoUsd ?? 0
  if (doArquivo > 0) return { tetoUsd: doArquivo, janelaMs, origem: 'arquivo' }
  return { tetoUsd: 0, janelaMs, origem: 'desligado' }
}

export interface LeituraDoTetoGlobal {
  tetoUsd: number
  janelaMs: number
  origem: OrigemDoTeto
  gastoUsd: number
  gastoEPiso: boolean
  runs: number
  bloqueado: boolean
  liberaEm: string
  liberaDaquiMs: number
}

function algumCustoNaoMedido(registros: RegistroDeRun[]): boolean {
  return registros.some(r => r.ias.some(ia => ia.custoMedido === false))
}

function instanteDeLiberacao(registros: RegistroDeRun[], tetoUsd: number, gastoUsd: number, janelaMs: number): number {
  let acumulado = gastoUsd
  for (const r of [...registros].sort((a, b) => a.concluidoEmMs - b.concluidoEmMs)) {
    acumulado -= r.custoUsd
    if (acumulado < tetoUsd) return r.concluidoEmMs + janelaMs
  }
  return 0
}

export function lerTetoGlobal(agoraMs: number = Date.now()): LeituraDoTetoGlobal {
  const teto = tetoGlobal()
  if (teto.tetoUsd <= 0) {
    return { ...teto, gastoUsd: 0, gastoEPiso: false, runs: 0, bloqueado: false, liberaEm: '', liberaDaquiMs: 0 }
  }
  const registros = loteDesde(agoraMs - teto.janelaMs).registros.filter(r => r.concluidoEmMs >= agoraMs - teto.janelaMs)
  const gastoUsd = registros.reduce((soma, r) => soma + (Number(r.custoUsd) || 0), 0)
  const bloqueado = gastoUsd >= teto.tetoUsd
  const liberaMs = bloqueado ? instanteDeLiberacao(registros, teto.tetoUsd, gastoUsd, teto.janelaMs) : 0
  return {
    ...teto,
    gastoUsd,
    gastoEPiso: algumCustoNaoMedido(registros),
    runs: registros.length,
    bloqueado,
    liberaEm: liberaMs ? new Date(liberaMs).toISOString() : '',
    liberaDaquiMs: liberaMs ? Math.max(0, liberaMs - agoraMs) : 0,
  }
}

export interface DespachoLiberado {
  pode: boolean
  motivo: string
}

export function despachoLiberado(agoraMs: number = Date.now()): DespachoLiberado {
  const g = lerTetoGlobal(agoraMs)
  if (!g.bloqueado) return { pode: true, motivo: '' }
  return {
    pode: false,
    motivo: `teto global de US$${g.tetoUsd} atingido (US$${g.gastoUsd.toFixed(2)} em ${g.runs} run(s) na janela${g.gastoEPiso ? ', piso medido — o real e maior' : ''}) — nenhum job novo inicia; os em voo terminam; libera ${g.liberaEm || 'quando a janela virar'}`,
  }
}
