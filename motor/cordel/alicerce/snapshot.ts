import { agentRoles, effortFor, harnessPorNome, modelFor, providerLimits, providerNameFor, providerNames } from '../../tomada/registro.ts'
import { provedoresDisponiveis } from '../../tomada/disponibilidade.ts'
import type { ProvedorDisponivel } from '../../tomada/disponibilidade.ts'
import { JANELA_5H, JANELA_SEMANA, consumoPorProvedor, serieDeCusto } from '../../euclides/tesouro/consumo.ts'
import { allCards } from '../store.ts'
import { resumoDaSessao } from '../../euclides/ias-da-sessao.ts'
import { sessaoParaChamada } from '../../euclides/tesouro/confianca.ts'
import { dailySpend } from '../../euclides/tesouro/lacuna.ts'
import { emExecucao } from '../../mirante/render/rodape.ts'
import type { AgentRole, HarnessId } from '../../tomada/tipos.ts'
import type { EstadoDaConfig, ItemDoLoop, LedgerDaSessao, LinhaDeProvedor } from '../../mirante/render/config/index.ts'
import { janelasDoProvedor } from '../../euclides/tesouro/janelas.ts'
import { gastoDoMotorNoIntervalo } from '../../euclides/tesouro/consumo.ts'
import type { JanelaDoPainel } from '../../mirante/render/config/tipos.ts'
import { arquivoDeGovernanca, tetoDoCard } from '../../euclides/tesouro/orcamento.ts'
import { avisarArquivoIlegivel, motivoDoErro } from './aviso.ts'

const BALDES_DA_SERIE = 48

function papeisDe(provedor: string): string[] {
  return agentRoles().filter(papel => providerNameFor(papel) === provedor)
}

function papelPrincipal(provedor: string): AgentRole | undefined {
  return papeisDe(provedor)[0] as AgentRole | undefined
}

function janelasDoPainel(nome: HarnessId, agoraMs: number): JanelaDoPainel[] {
  return janelasDoProvedor(nome, agoraMs).map((j): JanelaDoPainel => {
    const gasto = gastoDoMotorNoIntervalo(nome, j.inicioMs, j.fimMs)
    return {
      rotulo: j.rotulo,
      percentualDoLimite: j.percentualDoLimite,
      limiteConfiavel: j.limiteConfiavel,
      gastoDoMotorUsd: gasto.custoUsd,
      runsDoMotor: gasto.runs,
      restamMs: j.restamMs,
    }
  })
}

function linhaDeProvedor(nome: HarnessId, estados: Map<string, ProvedorDisponivel>, agoraMs: number): LinhaDeProvedor {
  const limites = providerLimits(nome)
  const papel = papelPrincipal(nome)
  const estado = estados.get(nome)
  const harness = harnessPorNome(nome)
  const plano = harness.plano(agoraMs)
  return {
    nome,
    situacao: estado ? estado.situacao : 'ausente',
    habilitado: habilitadoDe(nome, estado),
    motivo: estado && estado.situacao !== 'disponivel' ? estado.comoObter : '',
    plano: plano.plano,
    planoLido: harness.temLeitorDePlano,
    rodaLocal: harness.rodaLocal,
    detalheDoPlano: plano.detalhe,
    janelas: janelasDoPainel(nome, agoraMs),
    idadeDoUsoHoras: plano.idadeHoras,
    modelosDisponiveis: harness.modelosDisponiveis(),
    papeis: papeisDe(nome),
    modelo: papel ? modelFor(papel) ?? '' : '',
    esforco: papel ? effortFor(papel) ?? '' : '',
    restringeFerramenta: limites ? limites.restrictsTools : true,
    isolaLeitura: limites ? limites.isolatesReadonly : true,
    reportaCusto: limites ? limites.reportsCostUsd : true,
  }
}

export function habilitadoDe(nome: HarnessId, estado: ProvedorDisponivel | undefined): boolean {
  if (!estado || estado.situacao !== 'disponivel') return false
  return harnessPorNome(nome).prontoParaUso()
}

export function estadosPorNome(): Map<string, ProvedorDisponivel> {
  return new Map(provedoresDisponiveis().map(p => [p.nome, p]))
}

export function loopEmExecucao(repo: string, agoraMs: number): { itens: ItemDoLoop[]; fila: number } {
  const cards = allCards()
  const rodando = emExecucao(cards, repo, agoraMs, () => '')
  const itens = rodando.map(e => ({
    id: e.id,
    passo: e.estado.toLowerCase(),
    agente: e.agente,
    desde: e.desde,
  }))
  const fila = cards.filter(c => (!repo || c.repo === repo) && String(c.status ?? '') === 'READY').length
  return { itens, fila }
}

export function lerConfig(repo: string, selecionado: string, agoraMs: number = Date.now()): EstadoDaConfig {
  const estados = estadosPorNome()
  const provedores = providerNames().map(nome => linhaDeProvedor(nome, estados, agoraMs))
  const hoje = new Date(agoraMs).toISOString().slice(0, 10)
  const gasto = dailySpend(allCards().filter(c => !repo || c.repo === repo), hoje)
  const { itens, fila } = loopEmExecucao(repo, agoraMs)
  return {
    provedores,
    selecionado: provedores.some(p => p.nome === selecionado) ? selecionado : (provedores[0]?.nome ?? ''),
    uso5h: consumoPorProvedor(JANELA_5H, agoraMs),
    usoSemana: consumoPorProvedor(JANELA_SEMANA, agoraMs),
    serie: serieDeCusto(JANELA_5H, BALDES_DA_SERIE, agoraMs),
    loop: itens,
    fila,
    sessao: ledgerDaSessao(),
    gastoHoje: Number(gasto.total) || 0,
    // O teto do painel vem do MESMO lugar que o motor usa para barrar o card
    // (tetoDoCard: HICODE_CARD_BUDGET_USD, senao model-tier.json). Antes lia
    // `HICODE_BUDGET_USD`, variavel que nenhuma outra linha do repo escreve ou
    // le: o painel mostrava teto 0 — "sem teto" — enquanto o motor barrava em
    // US$16. Numero na tela que nao e o numero aplicado e pior que numero
    // nenhum, porque parece informacao.
    tetoUsd: tetoDoCardComFallback(),
    projeto: repo,
  }
}

// lerGovernanca() LANCA quando model-tier.json esta ilegivel, e um snapshot de
// painel nao pode derrubar a TUI por causa disso. Zero significa "nao sei o teto",
// e o painel escreve isso na tela em vez de omitir (renderConfig) — mas o operador
// tambem precisa saber POR QUE, senao corrompido fica indistinguivel de ausente.
function tetoDoCardComFallback(): number {
  try {
    return tetoDoCard()
  } catch (e) {
    avisarArquivoIlegivel(arquivoDeGovernanca(), motivoDoErro(e as Error), 'o painel nao vai mostrar o teto por card, e o motor recusa iniciar o gauntlet sem teto legivel')
    return 0
  }
}

function ledgerDaSessao(): LedgerDaSessao {
  const r = resumoDaSessao(sessaoParaChamada(''))
  return {
    curto: r.curto,
    papeis: r.ias.map(i => ({
      rotulo: i.rotulo,
      provedor: i.provedor,
      modelo: i.modelo,
      custoUsd: i.custoUsd,
      tokens: i.tokens,
      chamadas: i.chamadas,
      falhas: i.falhas,
    })),
    custoUsd: r.custoUsd,
    tokens: r.tokens,
  }
}

export function ordemDaConfig(): string[] {
  return providerNames()
}

