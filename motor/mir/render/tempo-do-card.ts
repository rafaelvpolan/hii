// O card contabilizava US$ e tokens, e nao contabilizava TEMPO. Perguntado em uso:
// "acho que demorou" — e nao havia numero para responder.
//
// Duas grandezas diferentes, e misturar as duas e o que faz a resposta mentir:
//
//   MOTOR  — segundos que o motor de fato gastou trabalhando, somados por passo e
//            acumulados entre execucoes (campo `tempo_s`). E o que custa dinheiro.
//   PAREDE — do `created` ate o `updated` (ou ate agora, se o card ainda anda).
//            Inclui o tempo em que o card ficou PARADO esperando VOCE aprovar.
//
// No card 006 o motor trabalhou ~33min mas a parede passou de 50min: a diferenca
// era espera humana. Mostrar so um dos dois aponta o dedo para o lado errado.
import { duracao } from './historico.ts'
import type { Fields } from '../../cdl/index.ts'

const TERMINAIS = ['PR_OPEN', 'MERGED', 'DEPLOYED', 'HALTED', 'CONFIRM']

export function tempoDeMotorS(fm: Fields): number {
  return Number(fm.tempo_s || '0') || 0
}

function msDe(iso: string | undefined): number {
  const t = Date.parse(String(iso ?? ''))
  return Number.isFinite(t) ? t : 0
}

export function tempoDeParedeS(fm: Fields, agoraMs: number): number {
  const inicio = msDe(fm.created)
  if (!inicio) return 0
  const paradoEm = TERMINAIS.includes(String(fm.status ?? '')) ? msDe(fm.updated) : 0
  const fim = paradoEm || agoraMs
  return Math.max(0, Math.round((fim - inicio) / 1000))
}

export function esperaHumanaS(fm: Fields, agoraMs: number): number {
  return Math.max(0, tempoDeParedeS(fm, agoraMs) - tempoDeMotorS(fm))
}

export function relatoDeTempo(fm: Fields, agoraMs: number): string {
  const motor = tempoDeMotorS(fm)
  const parede = tempoDeParedeS(fm, agoraMs)
  if (!motor && !parede) return ''
  if (!parede) return `motor ${duracao(motor)}`
  const espera = esperaHumanaS(fm, agoraMs)
  const cauda = espera > 0 ? ` (${duracao(espera)} esperando voce)` : ''
  return `motor ${duracao(motor)} · parede ${duracao(parede)}${cauda}`
}
