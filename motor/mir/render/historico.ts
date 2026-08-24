import { larguraDeTexto } from '../tui/largura.ts'
import { pintar, type Tom } from '../tui/paleta.ts'
import { chaveDaSessao, idDaSessao } from '../historico.ts'
import type { HistoricoDeSessoes, Sessao } from '../historico.ts'
import { idCurto } from '../../euc/ias-da-sessao.ts'
import type { IaDaSessao } from '../../cdl/tipos.ts'

export interface OpcoesDoHistorico {
  color?: boolean
  width?: number
  now?: number
  selecionado?: string
  avisoDeVazio?: string[]
}

const CABECALHO = 'historico de sessoes'

function tinta(texto: string, nome: Tom, o: OpcoesDoHistorico): string {
  return pintar(texto, nome, { color: o.color !== false })
}

function pad(s: string, n: number): string {
  const falta = n - larguraDeTexto(s)
  return falta > 0 ? s + ' '.repeat(falta) : s
}

function padEsq(s: string, n: number): string {
  const falta = n - larguraDeTexto(s)
  return falta > 0 ? ' '.repeat(falta) + s : s
}

export function quando(msSessao: number, agoraMs: number): string {
  const d = new Date(msSessao)
  const hora = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const dia = new Date(agoraMs)
  const mesmoDia = d.getFullYear() === dia.getFullYear() && d.getMonth() === dia.getMonth() && d.getDate() === dia.getDate()
  if (mesmoDia) return `hoje ${hora}`
  const ontem = new Date(agoraMs - 86_400_000)
  if (d.getFullYear() === ontem.getFullYear() && d.getMonth() === ontem.getMonth() && d.getDate() === ontem.getDate()) {
    return `ontem ${hora}`
  }
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${hora}`
}

export function duracao(segundos: number): string {
  if (segundos <= 0) return '—'
  if (segundos < 60) return `${segundos}s`
  const m = Math.floor(segundos / 60)
  if (m < 60) return `${m}m${String(segundos % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

const MENOR_QUE_UM_CENTAVO = 0.01

export function custo(usd: number): string {
  if (usd <= 0) return '—'
  return usd < MENOR_QUE_UM_CENTAVO ? `US$${usd.toFixed(4)}` : `US$${usd.toFixed(2)}`
}

export function tokens(total: number): string {
  if (total <= 0) return '—'
  if (total < 1000) return String(total)
  if (total < 1_000_000) return `${Math.round(total / 1000)}k`
  return `${(total / 1_000_000).toFixed(1)}M`
}

function modeloCurto(s: Sessao): string {
  if (s.tipo === 'conversa') {
    const provedores = [...new Set(s.ias.map(i => i.provedor).filter(Boolean))]
    return provedores.length ? provedores.join('+') : 'ia'
  }
  const provedor = s.provedorIdentificado ? s.provedor : '?'
  const modelo = (s.modelo || '').replace(/^claude-|-\d{8}$/g, '').replace(/-latest$/, '')
  return modelo ? `${provedor}/${modelo}` : provedor
}

function linhaDaSessao(s: Sessao, o: OpcoesDoHistorico, agoraMs: number): string {
  const marca = o.selecionado === chaveDaSessao(s) ? tinta('▸', 'destaque', o) : ' '
  const sinal = s.ok ? tinta('✓', 'sucesso', o) : tinta('✗', 'falha', o)
  const partes = [
    marca,
    pad(tinta(idCurto(idDaSessao(s)), 'destaque', o), 4),
    pad(tinta(quando(s.concluidoEmMs, agoraMs), 'apagado', o), 12),
    pad(tinta(s.tipo === 'conversa' ? 'chat' : `#${s.card}`, 'texto', o), 5),
    sinal,
    pad(tinta(modeloCurto(s), 'apagado', o), 22),
    padEsq(tinta(duracao(s.duracaoS), 'texto', o), 7),
    padEsq(tinta(custo(s.custoUsd), 'custo', o), 9),
    padEsq(tinta(tokens(s.tokens), 'apagado', o), 6),
  ]
  const base = ' ' + partes.join(' ')
  if (s.ok || !s.motivoDaFalha) return base
  return `${base}  ${tinta(s.motivoDaFalha.slice(0, 40), 'falha', o)}`
}

function iaDaSessao(ia: IaDaSessao, o: OpcoesDoHistorico): string {
  const modelo = ia.modelo ? `${ia.provedor}/${ia.modelo}` : ia.provedor
  const repetida = ia.chamadas > 1 ? ` ×${ia.chamadas}` : ''
  const piso = ia.custoMedido ? '' : tinta(' piso', 'atencao', o)
  return '      '
    + pad(tinta(ia.rotulo, 'texto', o), 9)
    + pad(tinta(modelo + repetida, 'apagado', o), 24)
    + padEsq(tinta(tokens(ia.tokens), 'apagado', o), 6)
    + padEsq(tinta(custo(ia.custoUsd), 'custo', o), 10)
    + piso
}

export function linhasDasIas(s: Sessao, o: OpcoesDoHistorico): string[] {
  if (!s.ias.length) {
    return ['      ' + tinta('sem ledger de IA nesta sessao (execucao anterior ao registro por chamada)', 'apagado', o)]
  }
  const linhas = s.ias.map(ia => iaDaSessao(ia, o))
  for (const t of s.trocas) {
    linhas.push('      ' + tinta(`⇄ ${t.rotulo} trocou de ia no meio: ${t.de} → ${t.para}`, 'atencao', o))
  }
  return linhas
}

function resumo(h: HistoricoDeSessoes, o: OpcoesDoHistorico): string {
  const dias = Math.round(h.janelaMs / 86_400_000)
  const pedacos = [
    `${h.totalNaJanela} execuc${h.totalNaJanela === 1 ? 'ao' : 'oes'}`,
    custo(h.custoTotalUsd),
    `${tokens(h.tokensTotal)} tok`,
    `${dias}d`,
  ]
  if (h.falhas > 0) pedacos.push(tinta(`${h.falhas} com falha`, 'falha', o))
  return '  ' + tinta(CABECALHO, 'destaque', o) + tinta(' · ' + pedacos.join(' · '), 'apagado', o)
}

export function renderHistorico(h: HistoricoDeSessoes, opts: OpcoesDoHistorico = {}): string[] {
  const agoraMs = opts.now ?? Date.now()
  if (!h.sessoes.length) {
    const aviso = opts.avisoDeVazio?.length
      ? opts.avisoDeVazio.map(l => '  ' + tinta(l, 'atencao', opts))
      : ['  ' + tinta('nenhuma sessao na janela — escreva uma tarefa para o motor executar', 'apagado', opts)]
    return [resumo(h, opts), '', ...aviso]
  }
  const linhas: string[] = [resumo(h, opts), '']
  for (const s of h.sessoes) {
    linhas.push(linhaDaSessao(s, opts, agoraMs))
    if (opts.selecionado && opts.selecionado === chaveDaSessao(s)) {
      linhas.push(...linhasDasIas(s, opts))
    }
  }
  return linhas
}
