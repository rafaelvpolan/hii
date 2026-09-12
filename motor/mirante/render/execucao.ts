import type { Atividade } from '../atividade.ts'
import type { ChamadaNaLinha, Marco } from '../../euclides/linha-do-tempo.ts'
import { semControle } from '../../cordel/util.ts'

const RESET = '\x1b[0m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const VERDE = '\x1b[32m'
const VERMELHO = '\x1b[31m'
const CIANO = '\x1b[36m'
const AMARELO = '\x1b[33m'
const MAGENTA = '\x1b[35m'

export interface OpcoesExecucao {
  color: boolean
  largura: number
}

const PADRAO: OpcoesExecucao = { color: false, largura: 78 }

const BULLET = '●'
const RAMO = '⎿'
const CALHA = '┃'
const INICIO_DE_BLOCO = '▶'
const FIM_DE_BLOCO = '■'
const FALHA_DE_BLOCO = '✕'
const TRACO = '─'
const GATE = '◆'
const REPARO = '↻'
const TIER = '◇'
const CHECKPOINT = '⏸'
const TROCA = '⇄'
const FASE = '▸'
const LIMITE_RESULTADO = 160

function paint(s: string, cor: string, o: OpcoesExecucao): string {
  return o.color && s ? `${cor}${s}${RESET}` : s
}

function capitalizar(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

function encurtar(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

export function chamadaDe(a: Atividade): string {
  if (a.tipo === 'agente') return `Task(${[a.nome, a.alvo].filter(Boolean).join(' — ')})`
  if (a.tipo === 'skill') return `Skill(${[a.nome, a.alvo].filter(Boolean).join(' — ')})`
  if (a.tipo === 'mcp') return `${a.alvo || a.nome}(${a.args ?? ''})`
  if (a.tipo === 'texto') return `${a.nome}(${a.alvo})`
  return `${capitalizar(a.nome)}(${a.alvo})`
}

function falhou(resultado: string): boolean {
  return /\b(erro|error|failed|falhou|denied|permission|nao consegui|exit=[1-9])/i.test(resultado)
}

function linhaDoResultado(a: Atividade, o: OpcoesExecucao): string[] {
  if (!a.resultado) return []
  const texto = encurtar(a.resultado, LIMITE_RESULTADO)
  const cor = falhou(texto) ? VERMELHO : DIM
  return [`  ${paint(RAMO, DIM, o)} ${paint(texto, cor, o)}`]
}

function prosa(a: Atividade, o: OpcoesExecucao): string[] {
  const calha = paint(CALHA, CIANO, o)
  return semControle(a.alvo).split('\n').map(l => `${calha} ${l}`)
}

export function separador(marca: string, textoBruto: string, largura: number, cor: string, o: OpcoesExecucao): string {
  const texto = encurtar(textoBruto, Math.max(12, largura - 8))
  const miolo = ` ${marca} ${texto} `
  const sobra = Math.max(2, largura - 2 - miolo.length)
  return paint(`${TRACO}${TRACO}${miolo}${TRACO.repeat(sobra)}`, cor, o)
}

function horaDe(ts: string): string {
  return ts.includes('T') ? (ts.split('T')[1] ?? '').replace('Z', '') : ''
}

function marco(a: Atividade, o: OpcoesExecucao): string[] {
  if (a.nome === 'timeout') return [separador(FALHA_DE_BLOCO, 'TIMEOUT — a IA foi encerrada', o.largura, VERMELHO, o)]
  if (a.tipo === 'sessao') {
    const partes = ['IA', a.args || '', a.alvo || 'sessao iniciada', horaDe(a.ts)].filter(Boolean)
    return ['', separador(INICIO_DE_BLOCO, partes.join(' · '), o.largura, CIANO, o)]
  }
  return [separador(FIM_DE_BLOCO, a.alvo ? `concluido · ${a.alvo}` : 'concluido', o.largura, VERDE, o)]
}

export function linhasDaAtividade(a: Atividade, opts: Partial<OpcoesExecucao> = {}): string[] {
  const o = { ...PADRAO, ...opts }
  if (a.tipo === 'sessao' || a.tipo === 'fim') return marco(a, o)
  if (a.tipo === 'texto' && !a.nome) return prosa(a, o)
  const chamada = chamadaDe(a)
  const abre = chamada.indexOf('(')
  const nome = abre > 0 ? chamada.slice(0, abre) : chamada
  const args = abre > 0 ? chamada.slice(abre) : ''
  return [
    `${paint(BULLET, CIANO, o)} ${paint(nome, BOLD, o)}${paint(args, DIM, o)}`,
    ...linhaDoResultado(a, o),
  ]
}

export function renderExecucao(atividades: Atividade[], opts: Partial<OpcoesExecucao> = {}): string[] {
  return atividades.flatMap(a => linhasDaAtividade(a, opts))
}

function corDoVeredito(veredito: string): string {
  if (/^APPROVED|^ok/i.test(veredito)) return VERDE
  if (/^BLOCKED|^NAO|^falhou/i.test(veredito)) return VERMELHO
  return AMARELO
}

function comPrefixo(linhas: string[], raia: string, o: OpcoesExecucao): string[] {
  if (!raia) return linhas
  const tag = paint(`[${raia}]`, DIM, o)
  return linhas.map(l => (l ? `${tag} ${l}` : l))
}

function duracao(s: number): string {
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`
}

function rodapeDaChamada(c: ChamadaNaLinha, o: OpcoesExecucao): string[] {
  if (!c.concluida) return []
  if (c.custoAnunciado === 'TIMEOUT') return [separador(FALHA_DE_BLOCO, 'TIMEOUT — a IA foi encerrada', o.largura, VERMELHO, o)]
  const falhou = c.ledger ? !c.ledger.ok : false
  const partes = [falhou ? `falhou${c.ledger?.classeDeFalha ? ` (${c.ledger.classeDeFalha})` : ''}` : 'concluido']
  if (c.ledger) {
    partes.push(`US$${c.ledger.custoUsd.toFixed(4)}`, `${c.ledger.tokens} tokens`, duracao(c.ledger.duracaoS))
    if (c.ledger.modelo || c.ledger.provedor) partes.push(c.ledger.modelo || c.ledger.provedor)
  } else if (c.custoAnunciado) {
    partes.push(c.custoAnunciado)
  }
  return [separador(falhou ? FALHA_DE_BLOCO : FIM_DE_BLOCO, partes.join(' · '), o.largura, falhou ? VERMELHO : VERDE, o)]
}

function linhasDaChamada(c: ChamadaNaLinha, o: OpcoesExecucao): string[] {
  const cabeca = ['IA', c.rotulo, c.modelo, horaDe(c.ts)].filter(Boolean).join(' · ')
  // A raia entra como prefixo visivel; o separador tem de caber DESCONTADO dele,
  // senao a linha da raia estoura a largura que as outras respeitam.
  const dentro = c.raia ? { ...o, largura: Math.max(20, o.largura - (c.raia.length + 3)) } : o
  const corpo = c.atividades.flatMap(a => linhasDaAtividade(a as Atividade, dentro))
  return comPrefixo(['', separador(INICIO_DE_BLOCO, cabeca, dentro.largura, CIANO, dentro), ...corpo, ...rodapeDaChamada(c, dentro)], c.raia, o)
}

export function linhasDoMarco(m: Marco, opts: Partial<OpcoesExecucao> = {}): string[] {
  const o = { ...PADRAO, ...opts }
  switch (m.tipo) {
    case 'chamada': return linhasDaChamada(m, o)
    case 'fase': return [separador(FASE, m.inicio ? `fase ${m.fase}${m.detalhe ? ` · ${m.detalhe}` : ''}` : `fim da fase ${m.fase}${m.detalhe ? ` · ${m.detalhe}` : ''}`, o.largura, m.inicio ? MAGENTA : DIM, o)]
    case 'gate': return m.inicio
      ? [`  ${paint(GATE, MAGENTA, o)} ${paint(`gate ${m.fase}`, BOLD, o)} ${paint(`revisando (${m.motivo || 'crivo'})`, DIM, o)}`]
      : [`  ${paint(GATE, corDoVeredito(m.veredito), o)} ${paint(`gate ${m.fase}`, BOLD, o)} ${paint(m.veredito, corDoVeredito(m.veredito), o)}${m.motivo ? ` ${paint(`— ${encurtar(m.motivo, LIMITE_RESULTADO)}`, DIM, o)}` : ''}`]
    case 'reparo': return [`  ${paint(REPARO, AMARELO, o)} ${paint(`reparo ${m.fase}`, BOLD, o)} ${paint(encurtar(m.detalhe, LIMITE_RESULTADO), DIM, o)}`]
    case 'tier': return [`  ${paint(TIER, DIM, o)} ${paint(`tier ${encurtar(m.detalhe, LIMITE_RESULTADO)}`, DIM, o)}`]
    case 'troca': return [`  ${paint(TROCA, AMARELO, o)} ${paint(`${m.papel}: ${m.de} → ${m.para}`, BOLD, o)} ${paint('troca de harness', DIM, o)}`]
    case 'checkpoint': return [separador(CHECKPOINT, m.aberto ? `esperando voce · ${m.estado}${m.detalhe ? ` (${m.detalhe})` : ''}` : `voce respondeu · ${m.estado}${m.detalhe ? ` (${m.detalhe})` : ''}`, o.largura, m.aberto ? AMARELO : VERDE, o)]
    default: return [`  ${paint('·', DIM, o)} ${paint(`${m.evento}${m.detalhe ? `: ${encurtar(m.detalhe, LIMITE_RESULTADO)}` : ''}`, DIM, o)}`]
  }
}

export function renderLinhaDoTempo(marcos: readonly Marco[], opts: Partial<OpcoesExecucao> = {}): string[] {
  return marcos.flatMap(m => linhasDoMarco(m, opts))
}
