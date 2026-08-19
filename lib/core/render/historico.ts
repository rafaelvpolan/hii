import { larguraDeTexto } from '../tui/largura'
import { pintar, type Tom } from '../tui/paleta'
import type { HistoricoDeSessoes, Sessao } from '../historico'

export interface OpcoesDoHistorico {
  color?: boolean
  width?: number
  now?: number
  selecionado?: string
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

export function custo(usd: number): string {
  return usd > 0 ? `US$${usd.toFixed(2)}` : '—'
}

export function tokens(total: number): string {
  if (total <= 0) return '—'
  if (total < 1000) return String(total)
  if (total < 1_000_000) return `${Math.round(total / 1000)}k`
  return `${(total / 1_000_000).toFixed(1)}M`
}

function modeloCurto(s: Sessao): string {
  const provedor = s.provedorIdentificado ? s.provedor : '?'
  const modelo = (s.modelo || '').replace(/^claude-|-\d{8}$/g, '').replace(/-latest$/, '')
  return modelo ? `${provedor}/${modelo}` : provedor
}

function linhaDaSessao(s: Sessao, o: OpcoesDoHistorico, agoraMs: number): string {
  const marca = o.selecionado === s.card ? tinta('▸', 'destaque', o) : ' '
  const sinal = s.ok ? tinta('✓', 'sucesso', o) : tinta('✗', 'falha', o)
  const partes = [
    marca,
    pad(tinta(quando(s.concluidoEmMs, agoraMs), 'apagado', o), 12),
    pad(tinta(`#${s.card}`, 'texto', o), 5),
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
    return [
      resumo(h, opts),
      '',
      '  ' + tinta('nenhuma sessao na janela — escreva uma tarefa para o motor executar', 'apagado', opts),
    ]
  }
  return [resumo(h, opts), '', ...h.sessoes.map(s => linhaDaSessao(s, opts, agoraMs))]
}
