import { agentRoles, effortFor, harnessPorNome, modelFor, providerLimits, providerNameFor, providerNames } from '../../tmd/registro'
import { provedoresDisponiveis } from '../../tmd/disponibilidade'
import type { ProvedorDisponivel } from '../../tmd/disponibilidade'
import { JANELA_5H, JANELA_SEMANA, consumoPorProvedor, serieDeCusto } from '../../euc/tsr/consumo'
import { allCards } from '../store'
import { resumoDaSessao } from '../../euc/ias-da-sessao'
import { sessaoParaChamada } from '../../euc/tsr/confianca'
import { dailySpend } from '../../euc/tsr/lacuna'
import { emExecucao } from '../../mir/render/rodape'
import type { AgentRole, HarnessId } from '../../tmd/tipos'
import type { EstadoDaConfig, ItemDoLoop, LedgerDaSessao, LinhaDeProvedor } from '../../mir/render/config'
import { janelasDoProvedor } from '../../euc/tsr/janelas'
import { gastoDoMotorNoIntervalo } from '../../euc/tsr/consumo'
import type { JanelaDoPainel } from '../../mir/render/config/tipos'

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
    tetoUsd: Number(process.env.HICODE_BUDGET_USD ?? '0'),
    projeto: repo,
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

