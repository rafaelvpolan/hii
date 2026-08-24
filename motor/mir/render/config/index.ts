import { caixa, grade } from '../widget/caixa.ts'
import { serie } from '../widget/serie.ts'
import { painelDaSessao, painelDeIas, painelDeTokens, painelDeUso, painelDoLoop, painelDoPlano, painelDoProvedor } from './paineis.ts'
import type { EstadoDaConfig, OpcoesConfig } from './tipos.ts'
import { truncVisible } from '../../tui/layout.ts'

export type { EstadoDaConfig, LinhaDeProvedor, ItemDoLoop, LedgerDaSessao, PapelDaSessao, OpcoesConfig } from './tipos.ts'

const DIM = '\x1b[2m'
const RESET = '\x1b[0m'
const CYAN = '\x1b[36m'
const ALTURA_DA_SERIE = 3
const ALTURA_DA_SERIE_COMPACTA = 1
const ALTURA_COMPACTA = 22

function paint(s: string, cor: string, o: OpcoesConfig): string {
  return o.color && s ? `${cor}${s}${RESET}` : s
}

function colunas(largura: number): number {
  return largura >= 96 ? 2 : 1
}

function larguraDaColuna(largura: number, cols: number): number {
  return Math.max(24, Math.floor(largura / cols))
}

function ehCompacto(altura: number): boolean {
  return altura > 0 && altura < ALTURA_COMPACTA
}

// Zero significa "nao sei o teto" (governanca ilegivel) e nao "sem teto": nesse
// caso a linha diz isso, em vez de omitir e parecer que nao ha limite.
function tetoNaLinha(tetoUsd: number): string {
  return tetoUsd > 0 ? ` · teto por card US$ ${tetoUsd.toFixed(2)}` : ' · teto por card NAO LEGIVEL (confira config/model-tier.json)'
}

export function renderConfig(e: EstadoDaConfig, o: OpcoesConfig): string[] {
  const cols = colunas(o.largura)
  const w = larguraDaColuna(o.largura, cols)
  const compacto = ehCompacto(o.altura)
  const escolhido = e.provedores.find(p => p.nome === e.selecionado)
  const opcoes: OpcoesConfig = { ...o, largura: w }
  const cx = { color: o.color, largura: w }

  const blocos = [
    caixa('IAS · instalada / ligada / plano', painelDeIas(e, w - 2, opcoes), cx),
    caixa(`${(e.selecionado || 'ia').toUpperCase()} · PLANO E USO`, painelDoPlano(escolhido, w - 2, opcoes), cx),
    caixa(`${(e.selecionado || 'ia').toUpperCase()} · CONFIGURADO`, painelDoProvedor(escolhido, w - 2, opcoes), cx),
    caixa('GASTO DO MOTOR · 5H', painelDeUso(e.uso5h, w - 2, opcoes), cx),
    ...(compacto ? [] : [caixa('GASTO DO MOTOR · 7D', painelDeUso(e.usoSemana, w - 2, opcoes), cx)]),
    ...(compacto ? [] : [caixa('TOKENS 5H', painelDeTokens(e.uso5h, w - 2, opcoes), cx)]),
    caixa('LOOP EM EXECUCAO', painelDoLoop(e.loop, e.fila, w - 2, opcoes), cx),
    caixa(`SESSAO ${e.sessao.curto} · POR PAPEL`, painelDaSessao(e.sessao, w - 2, opcoes), cx),
  ]

  // O teto vinha calculado no snapshot e NINGUEM o mostrava: o humano via o gasto
  // e nao o limite que o motor aplica em cada card. Valor computado e nao aplicado,
  // com a agravante de estar a uma linha da tela.
  //
  // O corte pela largura e obrigatorio: a linha do cabecalho e medida junto com as
  // caixas, e o painel exige largura visivel igual em todas as linhas.
  const resumo = `projeto ${e.projeto || '(nenhum)'} · gasto hoje US$ ${e.gastoHoje.toFixed(2)}${tetoNaLinha(e.tetoUsd)}`
  const cabecalho = [
    `  ${paint('/config', CYAN, o)}  ${paint(truncVisible(resumo, Math.max(8, o.largura - 13)), DIM, o)}`,
    '',
  ]
  const custo = caixa('CUSTO NA JANELA DE 5H', serie(e.serie, {
    color: o.color, largura: o.largura - 4, altura: compacto ? ALTURA_DA_SERIE_COMPACTA : ALTURA_DA_SERIE,
  }), { color: o.color, largura: o.largura })

  return [...cabecalho, ...grade(blocos, { largura: o.largura, colunas: cols }), ...custo]
}
