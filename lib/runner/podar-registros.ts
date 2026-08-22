import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { cardsDir } from './config'
import { readCard } from './card-store'
import { JANELA_HISTORICO_MS } from '../core/historico'

const SUFIXO_DO_LEDGER = '.ias.jsonl'
const PREFIXO_DA_CONVERSA = 'conversa-'

export interface PodaDeRegistros {
  removidos: string[]
  bytesLiberados: number
}

function ttlMs(): number {
  const bruto = Number(process.env.HICODE_REGISTROS_TTL_MS)
  return Number.isFinite(bruto) && bruto > 0 ? bruto : JANELA_HISTORICO_MS
}

export function cardDoLedger(arquivo: string): string {
  if (!arquivo.endsWith(SUFIXO_DO_LEDGER)) return ''
  const sessao = arquivo.slice(0, -SUFIXO_DO_LEDGER.length)
  const id = sessao.split('-')[0] ?? ''
  return id === 'conversa' ? '' : id
}

export function ehRegistroPodavel(arquivo: string): boolean {
  return arquivo.endsWith(SUFIXO_DO_LEDGER)
    || (arquivo.startsWith(PREFIXO_DA_CONVERSA) && arquivo.endsWith('.json'))
}

function pertenceACardVivo(arquivo: string): boolean {
  const card = cardDoLedger(arquivo)
  return !!card && !!readCard(card)
}

export function podarRegistrosAntigos(agoraMs: number = Date.now()): PodaDeRegistros {
  const dir = join(cardsDir(), 'runs')
  const out: PodaDeRegistros = { removidos: [], bytesLiberados: 0 }
  if (!existsSync(dir)) return out
  const limite = agoraMs - ttlMs()
  for (const arquivo of readdirSync(dir)) {
    if (!ehRegistroPodavel(arquivo)) continue
    if (pertenceACardVivo(arquivo)) continue
    const caminho = join(dir, arquivo)
    try {
      const s = statSync(caminho)
      if (s.mtimeMs >= limite) continue
      rmSync(caminho, { force: true })
      out.removidos.push(arquivo)
      out.bytesLiberados += s.size
    } catch {
      continue
    }
  }
  return out
}
