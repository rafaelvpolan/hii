import { padVisible, truncVisible } from '../../tui/layout'
import { barraRotulada } from '../widget/barra'
import type { ConsumoDoProvedor } from '../../../ai/consumo'
import type { EstadoDaConfig, ItemDoLoop, JanelaDoPainel, LedgerDaSessao, LinhaDeProvedor, OpcoesConfig } from './tipos'

const DIM = '\x1b[2m'
const RESET = '\x1b[0m'
const CYAN = '\x1b[36m'
const VERDE = '\x1b[32m'
const VERMELHO = '\x1b[31m'
const CURSOR = '▸'

function paint(s: string, cor: string, o: { color: boolean }): string {
  return o.color && s ? `${cor}${s}${RESET}` : s
}

function campo(rotulo: string, valor: string, largura: number, o: OpcoesConfig): string {
  const espaco = Math.max(4, Math.floor(largura * 0.42))
  return ` ${paint(padVisible(rotulo, espaco), DIM, o)}${truncVisible(valor, Math.max(1, largura - espaco - 2))}`
}

const AMARELO = '\x1b[33m'

function rotuloDaSituacao(p: LinhaDeProvedor, o: OpcoesConfig): string {
  if (p.situacao === 'disponivel') return paint('conectada', VERDE, o)
  if (p.situacao === 'precisa-servidor') return paint('servidor local', AMARELO, o)
  if (p.situacao === 'nao-autenticado') return paint('sem login', AMARELO, o)
  if (p.situacao === 'cota-esgotada') return paint('cota estourada', VERMELHO, o)
  return paint('ausente', VERMELHO, o)
}

function sim(v: boolean, o: OpcoesConfig): string {
  return v ? paint('sim', VERDE, o) : paint('nao', VERMELHO, o)
}

function conectadoNaNuvem(p: LinhaDeProvedor): boolean {
  return p.nome !== 'ollama' && (p.situacao === 'disponivel' || p.situacao === 'cota-esgotada')
}

function semTierPago(p: LinhaDeProvedor): boolean {
  return p.planoLido && conectadoNaNuvem(p)
}

function rotuloDoPlano(p: LinhaDeProvedor): string {
  if (p.plano) return p.plano
  if (semTierPago(p)) return '(free)'
  if (conectadoNaNuvem(p)) return 'plano nao lido'
  return '—'
}

export function painelDeIas(e: EstadoDaConfig, largura: number, o: OpcoesConfig): string[] {
  if (!e.provedores.length) return [' nenhuma ia configurada']
  return e.provedores.map((p) => {
    const marca = p.nome === e.selecionado ? paint(CURSOR, CYAN, o) : ' '
    const estado = padVisible(rotuloDaSituacao(p, o), 14)
    const nome = p.nome === e.selecionado ? paint(padVisible(p.nome, 8), CYAN, o) : padVisible(p.nome, 8)
    const ligada = padVisible(p.habilitado ? paint('on', VERDE, o) : paint('off', DIM, o), 3)
    const plano = rotuloDoPlano(p)
    return truncVisible(` ${marca} ${nome} ${estado} ${ligada}  ${paint(plano, DIM, o)}`, largura)
  })
}

function quandoReseta(restamMs: number): string {
  if (restamMs <= 0) return ''
  const horas = Math.floor(restamMs / 3600_000)
  if (horas >= 24) return `reseta ${Math.floor(horas / 24)}d${horas % 24}h`
  if (horas >= 1) return `reseta ${horas}h`
  return `reseta ${Math.max(1, Math.round(restamMs / 60_000))}min`
}

function gastoDoMotor(j: JanelaDoPainel): string {
  if (!j.runsDoMotor) return 'motor nao rodou aqui'
  const casas = j.gastoDoMotorUsd < 0.01 ? 4 : 2
  return `motor US$${j.gastoDoMotorUsd.toFixed(casas)} · ${j.runsDoMotor} run`
}

function linhasDaJanela(j: JanelaDoPainel, medidor: number, largura: number, o: OpcoesConfig): string[] {
  const cauda = [gastoDoMotor(j), quandoReseta(j.restamMs)].filter(Boolean).join(' · ')
  if (j.percentualDoLimite === null) {
    return [
      truncVisible(` ${padVisible(j.rotulo, 8)} ${paint('limite nao reportado', DIM, o)}`, largura),
      truncVisible(`          ${paint(cauda, DIM, o)}`, largura),
    ]
  }
  const barra = ' ' + barraRotulada(j.rotulo, j.percentualDoLimite, 100, {
    color: o.color, largura: medidor, mostrarPercentual: true, rotuloEm: 8,
  })
  const aviso = j.limiteConfiavel ? '' : paint(' (leitura mais velha que a janela)', AMARELO, o)
  return [truncVisible(barra + aviso, largura), truncVisible(`          ${paint(cauda, DIM, o)}`, largura)]
}

export function painelDoPlano(p: LinhaDeProvedor | undefined, largura: number, o: OpcoesConfig): string[] {
  if (!p) return [' escolha uma ia com ↑↓']
  if (!p.plano) {
    if (semTierPago(p)) return [' (free) — nenhum tier pago identificado']
    if (conectadoNaNuvem(p)) return [' plano nao lido — o hii nao sabe ler o tier desta ia']
    return [' plano nao descoberto nesta maquina']
  }
  const linhas = [campo('plano', p.plano, largura, o)]
  if (p.detalheDoPlano) linhas.push(campo('conta', p.detalheDoPlano, largura, o))
  if (!p.janelas.length) linhas.push(campo('uso', 'sem janela reportada', largura, o))
  const medidor = Math.max(8, largura - 30)
  for (const j of p.janelas) {
    linhas.push(...linhasDaJanela(j, medidor, largura, o))
  }
  if (p.janelas.length && p.idadeDoUsoHoras >= 0) {
    const idade = p.idadeDoUsoHoras < 1
      ? `medido ha ${Math.round(p.idadeDoUsoHoras * 60)} min`
      : `medido ha ${p.idadeDoUsoHoras.toFixed(0)}h`
    const velho = p.idadeDoUsoHoras > 6
    linhas.push(' ' + paint(velho ? `${idade} — VELHO, abra o claude` : idade, velho ? AMARELO : DIM, o))
  }
  if (p.modelosDisponiveis.length) {
    linhas.push(campo('modelos', p.modelosDisponiveis.slice(0, 3).join(', '), largura, o))
  }
  return linhas.map(l => truncVisible(l, largura))
}

export function painelDoProvedor(p: LinhaDeProvedor | undefined, largura: number, o: OpcoesConfig): string[] {
  if (!p) return [' escolha uma ia com ↑↓']
  const linhas = [
    campo('modelo', p.modelo || '(padrao do cli)', largura, o),
    campo('esforco', p.esforco || '(nao aceita)', largura, o),
    campo('papeis', p.papeis.length ? p.papeis.join(', ') : 'nenhum', largura, o),
    campo('restringe tool', sim(p.restringeFerramenta, o), largura, o),
    campo('isola leitura', sim(p.isolaLeitura, o), largura, o),
    campo('reporta custo', sim(p.reportaCusto, o), largura, o),
  ]
  if (p.situacao !== 'disponivel' && p.motivo) linhas.push(campo('como obter', p.motivo, largura, o))
  return linhas
}

function totalDe(uso: ConsumoDoProvedor[]): number {
  return uso.reduce((t, u) => t + u.custoUsd, 0)
}

function atribuicaoDe(uso: ConsumoDoProvedor[]): string {
  const porChamada = uso.filter(u => u.porChamada).length
  if (porChamada === uso.length) return 'por chamada de ia'
  if (porChamada === 0) return 'por execucao (sem ledger)'
  return `${porChamada}/${uso.length} por chamada de ia`
}

export function painelDeUso(uso: ConsumoDoProvedor[], largura: number, o: OpcoesConfig): string[] {
  if (!uso.length) return [' sem execucao nesta janela']
  const total = totalDe(uso)
  const medidor = Math.max(8, largura - 22)
  const linhas = uso.slice(0, 5).map(u =>
    truncVisible(' ' + barraRotulada(u.provedor, u.custoUsd, total || 1, {
      color: o.color, largura: medidor, mostrarPercentual: true, rotuloEm: 9,
    }), largura))
  const tokens = uso.reduce((t, u) => t + u.tokens, 0)
  linhas.push(campo('gasto', `US$ ${total.toFixed(4)}`, largura, o))
  linhas.push(campo('tokens', tokens.toLocaleString('pt-BR'), largura, o))
  linhas.push(campo('atribuicao', atribuicaoDe(uso), largura, o))
  return linhas
}

export function painelDeTokens(uso: ConsumoDoProvedor[], largura: number, o: OpcoesConfig): string[] {
  if (!uso.length) return [' sem tokens na janela']
  return uso.slice(0, 4).flatMap(u => [
    ` ${paint(u.provedor, CYAN, o)} ${paint(u.modelos.join(',') || '(sem modelo)', DIM, o)}`,
    campo('  entrada', u.tokensEntrada.toLocaleString('pt-BR'), largura, o),
    campo('  saida', u.tokensSaida.toLocaleString('pt-BR'), largura, o),
    campo('  cache', u.tokensCache.toLocaleString('pt-BR'), largura, o),
  ])
}

export function painelDoLoop(loop: ItemDoLoop[], fila: number, largura: number, o: OpcoesConfig): string[] {
  if (!loop.length) return [fila ? ` ${fila} na fila, nada em execucao` : ' nada em execucao']
  const linhas = loop.slice(0, 5).map(i => truncVisible(
    ` ${paint(`#${i.id}`, CYAN, o)} ${padVisible(i.passo, 12)} ${paint(padVisible(i.agente, 9), DIM, o)} ${i.desde}`,
    largura))
  if (fila) linhas.push(paint(` +${fila} na fila`, DIM, o))
  return linhas
}

export function painelDaSessao(sessao: LedgerDaSessao, largura: number, o: OpcoesConfig): string[] {
  if (!sessao.papeis.length) return [' esta sessao ainda nao chamou IA']
  const linhas = sessao.papeis.map((papel) => {
    const ia = papel.modelo ? `${papel.provedor}/${papel.modelo}` : papel.provedor
    const falhas = papel.falhas ? `${paint(`${papel.falhas} falha(s)`, VERMELHO, o)} ` : ''
    const cauda = `${papel.chamadas}x · US$${papel.custoUsd.toFixed(4)} · ${papel.tokens} tok`
    return truncVisible(` ${padVisible(papel.rotulo, 9)}${padVisible(ia, 17)} ${falhas}${paint(cauda, DIM, o)}`, largura)
  })
  const total = ` ${padVisible('total', 9)}${padVisible('', 17)} ${paint(`US$${sessao.custoUsd.toFixed(4)} · ${sessao.tokens} tok`, DIM, o)}`
  return [...linhas, truncVisible(total, largura)]
}
