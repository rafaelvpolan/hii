import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cardsDir } from '../../cordel/alicerce/config.ts'
import { withFileLock, writeFileAtomic } from '../mutirao/trava-arquivo.ts'

export type ModoDoMotor = 'gateway' | 'passivo'

export interface ConfigDoOrquestrador {
  versao: 1
  projeto: string
  modo: ModoDoMotor
  concorrencia: number
  revisao: number
}

export function chaveDoProjeto(projeto: string): string {
  return createHash('sha256').update(projeto).digest('hex').slice(0, 24)
}

export function arquivoDoOrquestrador(projeto: string): string {
  return join(cardsDir(), 'orquestracao', `${chaveDoProjeto(projeto)}.json`)
}

export function configDoOrquestrador(projeto: string): ConfigDoOrquestrador {
  const arquivo = arquivoDoOrquestrador(projeto)
  if (!existsSync(arquivo)) return { versao: 1, projeto, modo: 'gateway', concorrencia: 1, revisao: 0 }
  const c = JSON.parse(readFileSync(arquivo, 'utf8')) as ConfigDoOrquestrador
  if (c?.versao !== 1 || c.projeto !== projeto || !['gateway', 'passivo'].includes(c.modo)
    || !Number.isInteger(c.revisao) || !Number.isInteger(c.concorrencia) || c.concorrencia < 1 || c.concorrencia > 4) {
    throw new Error('configuracao do orquestrador invalida: confira versao, projeto, modo e concorrencia (1-4)')
  }
  // Configuracoes antigas nao podem transformar pedidos comuns em orquestracao.
  return { ...c, modo: 'gateway' }
}

export function configurarOrquestrador(projeto: string, concorrencia: number): ConfigDoOrquestrador {
  if (!projeto.trim()) throw new Error('selecione um projeto antes de configurar o orquestrador')
  if (!Number.isInteger(concorrencia) || concorrencia < 1 || concorrencia > 4) {
    throw new Error('concorrencia deve ser um inteiro entre 1 e 4')
  }
  mkdirSync(join(cardsDir(), 'orquestracao'), { recursive: true })
  const arquivo = arquivoDoOrquestrador(projeto)
  return withFileLock(arquivo, () => {
    const anterior = configDoOrquestrador(projeto)
    if (anterior.concorrencia === concorrencia) return anterior
    const proxima: ConfigDoOrquestrador = { ...anterior, concorrencia, revisao: anterior.revisao + 1 }
    writeFileAtomic(arquivo, JSON.stringify(proxima, null, 2) + '\n')
    return proxima
  })
}

export function modoDaExecucao(campos: Record<string, string>): ModoDoMotor | 'legado' {
  return campos.motor_modo === 'gateway' || campos.motor_modo === 'passivo' ? campos.motor_modo : 'legado'
}
