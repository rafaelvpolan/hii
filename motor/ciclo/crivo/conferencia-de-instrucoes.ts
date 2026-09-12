import { isoNow } from '../../cordel/index.ts'
import type { Card, Fields } from '../../cordel/index.ts'
import { ROOT } from '../../cordel/alicerce/config.ts'
import { patchCard, readCard } from '../../cordel/store.ts'
import { providerFor, modelFor } from '../../tomada/registro.ts'
import { campoDeOverrideDoPapel } from '../../tomada/rota.ts'
import { esforcoGovernado, modeloGovernado } from '../../oswaldo/rui.ts'
import { runProvider } from '../../euclides/tesouro/confianca.ts'
import { sumTokens } from '../../tomada/uso.ts'
import { subPrompts } from '../../mirante/instruir.ts'
import { accumulatedDiff, objetosJson, timeoutForDiff } from './gate.ts'

export interface InstrucaoNumerada {
  numero: number
  texto: string
}

export interface ItemConferido {
  numero: number
  atendida: boolean
  motivo: string
}

export interface Conferencia {
  conclusiva: boolean
  itens: ItemConferido[]
  motivo: string
  cost: number
  tokens: number
  provider?: string
}

export const CAMPO_ATENDIDAS = 'instrucoes_atendidas'

export function atendidasDe(fm: Fields): Set<number> {
  return new Set(String(fm[CAMPO_ATENDIDAS] ?? '').split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0))
}

export function marcarAtendidas(atual: string, numeros: readonly number[]): string {
  const todas = new Set([...atendidasDe({ [CAMPO_ATENDIDAS]: atual }), ...numeros])
  return [...todas].sort((a, b) => a - b).join(',')
}

export function instrucoesDoCard(card: Card): InstrucaoNumerada[] {
  return subPrompts(card.body).map((texto, i) => ({ numero: i + 1, texto }))
}

export function pendentesDoCard(card: Card): InstrucaoNumerada[] {
  const atendidas = atendidasDe(card.fm)
  return instrucoesDoCard(card).filter(i => !atendidas.has(i.numero))
}

export function listaNumerada(itens: readonly InstrucaoNumerada[]): string {
  return itens.map(i => `${i.numero}. ${i.texto}`).join('\n')
}

interface ItemBruto {
  n?: number | string
  atendida?: boolean | string
  motivo?: string
}

interface RespostaBruta {
  itens?: ItemBruto[]
}

function umaLinha(s: string): string {
  return String(s || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200)
}

export function parseConferencia(texto: string, esperados: readonly number[]): ItemConferido[] | null {
  const objetos = objetosJson(texto)
  for (let k = objetos.length - 1; k >= 0; k--) {
    let bruto: RespostaBruta
    try {
      bruto = JSON.parse(objetos[k] ?? '') as RespostaBruta
    } catch {
      continue
    }
    if (!Array.isArray(bruto.itens)) continue
    const porNumero = new Map<number, ItemBruto>()
    for (const it of bruto.itens) {
      const n = Number(it?.n)
      if (Number.isInteger(n) && n > 0) porNumero.set(n, it)
    }
    return esperados.map(n => {
      const it = porNumero.get(n)
      if (!it) return { numero: n, atendida: false, motivo: 'o crivo nao se pronunciou sobre esta instrucao' }
      const atendida = it.atendida === true || String(it.atendida).toLowerCase() === 'true'
      return { numero: n, atendida, motivo: umaLinha(it.motivo ?? '') || (atendida ? 'atendida' : 'nao atendida') }
    })
  }
  return null
}

function promptDaConferencia(instrucoes: readonly InstrucaoNumerada[], names: string, patch: string): string {
  return [
    'Voce e o CRIVO conferindo ORDENS do humano — read-only. O humano deu as instrucoes numeradas abaixo e um agente disse que as atendeu. Voce nao acredita no relato: confere no DIFF ACUMULADO da branch se cada instrucao foi de fato atendida (a mudanca existe e faz o que foi pedido).',
    '',
    `INSTRUCOES DO HUMANO:\n${listaNumerada(instrucoes)}`,
    '',
    `ARQUIVOS ALTERADOS:\n${names}`,
    '',
    `DIFF:\n${patch}`,
    '',
    'Para CADA numero, responda se foi atendida e um motivo curto que aponte a evidencia no diff (arquivo, seletor, funcao) ou a ausencia dela.',
    'Em duvida, atendida=false com o motivo: uma volta a mais custa menos do que entregar uma ordem ignorada.',
    'Responda APENAS um JSON em uma unica linha, sem prosa antes ou depois:',
    '{"itens":[{"n":1,"atendida":true,"motivo":"curto"},{"n":2,"atendida":false,"motivo":"curto"}]}',
  ].join('\n')
}

export async function conferirInstrucoes(id: string, wt: string, base: string, instrucoes: readonly InstrucaoNumerada[]): Promise<Conferencia> {
  if (!instrucoes.length) return { conclusiva: true, itens: [], motivo: 'nada a conferir', cost: 0, tokens: 0 }
  const diff = await accumulatedDiff(wt, base, true)
  if (diff.falhou) return { conclusiva: false, itens: [], motivo: `nao consegui ler o diff — ${diff.falhou}`, cost: 0, tokens: 0 }
  if (!diff.names.trim()) {
    return {
      conclusiva: true,
      itens: instrucoes.map(i => ({ numero: i.numero, atendida: false, motivo: 'nenhuma mudanca na branch em relacao a base' })),
      motivo: 'sem mudancas vs a base',
      cost: 0,
      tokens: 0,
    }
  }
  const fm = readCard(id)?.fm ?? {}
  const override = fm[campoDeOverrideDoPapel('gate')] || undefined
  const provider = providerFor('gate', override)
  const res = await runProvider(id, provider, {
    prompt: promptDaConferencia(instrucoes, diff.names, diff.patch),
    cwd: ROOT,
    dirs: [wt],
    mode: 'readonly',
    useAgents: false,
    model: override ? modelFor('gate', override) : modeloGovernado('gate', 'review', fm),
    effort: esforcoGovernado('gate', 'review', fm),
    expectsJson: true,
    timeoutMs: timeoutForDiff(diff),
  }, 'gate')
  const tokens = sumTokens(res.usage)
  if (res.failed) {
    return { conclusiva: false, itens: [], motivo: `conferencia NAO executou (${res.timedOut ? 'timeout' : 'erro'}): ${umaLinha(res.detail).slice(0, 120)}`, cost: res.cost, tokens, provider: provider.name }
  }
  const itens = parseConferencia(res.text, instrucoes.map(i => i.numero))
  if (!itens) return { conclusiva: false, itens: [], motivo: 'conferencia sem JSON parseavel na saida', cost: res.cost, tokens, provider: provider.name }
  return { conclusiva: true, itens, motivo: '', cost: res.cost, tokens, provider: provider.name }
}

export type Conferidor = typeof conferirInstrucoes

export interface ResultadoDoRegistro {
  faltam: ItemConferido[]
  conclusiva: boolean
}

export function registrarConferencia(id: string, conferencia: Conferencia): ResultadoDoRegistro {
  if (!conferencia.conclusiva) {
    patchCard(id, {}, `${isoNow()} conferencia das instrucoes: inconclusiva — ${conferencia.motivo}; a decisao fica com voce`)
    return { faltam: [], conclusiva: false }
  }
  const atendidas = conferencia.itens.filter(i => i.atendida).map(i => i.numero)
  const faltam = conferencia.itens.filter(i => !i.atendida)
  const linhas = conferencia.itens.map(i => `instrucao ${i.numero}: ${i.atendida ? 'ATENDIDA' : 'NAO atendida'} — ${i.motivo}`)
  const fm = readCard(id)?.fm ?? {}
  patchCard(id, { [CAMPO_ATENDIDAS]: marcarAtendidas(String(fm[CAMPO_ATENDIDAS] ?? ''), atendidas) }, `${isoNow()} conferencia das instrucoes (crivo${conferencia.provider ? ` ${conferencia.provider}` : ''}): ${linhas.join(' · ')}`)
  return { faltam, conclusiva: true }
}
