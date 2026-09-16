import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cardsDir } from '../cordel/alicerce/config.ts'
import { withFileLock, writeFileAtomic } from '../oswaldo/mutirao/trava-arquivo.ts'
import { ErroApi } from './contrato.ts'

export interface RespostaApi { status: number; corpo: string; etag?: string; artefatoVerificado?: true }
export function resposta(status: number, corpo: object, etag?: string): RespostaApi {
  return { status, corpo: JSON.stringify(corpo), etag }
}
export function hash(texto: string): string { return createHash('sha256').update(texto).digest('hex') }
interface Registro { hash: string; resposta?: RespostaApi }

export function umaVez(chave: string, pedido: string, executar: () => RespostaApi): RespostaApi {
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(chave)) throw new ErroApi(400, 'idempotencia_obrigatoria', 'envie Idempotency-Key com 8-128 caracteres')
  const dir = join(cardsDir(), 'ponte', 'pedidos')
  mkdirSync(dir, { recursive: true })
  const arquivo = join(dir, `${hash(chave)}.json`)
  return withFileLock(arquivo, () => {
    const fingerprint = hash(pedido)
    if (existsSync(arquivo)) {
      const anterior = JSON.parse(readFileSync(arquivo, 'utf8')) as Registro
      if (anterior.hash !== fingerprint) throw new ErroApi(409, 'chave_reutilizada', 'chave ja usada com outro pedido')
      if (!anterior.resposta) throw new ErroApi(409, 'resultado_incerto', 'pedido interrompido; reconcilie o estado antes de tentar novamente')
      return anterior.resposta
    }
    // O marcador vem antes do efeito: apos crash nao se repete uma acao paga.
    writeFileAtomic(arquivo, JSON.stringify({ hash: fingerprint }))
    let r: RespostaApi
    try { r = executar() } catch (erro) {
      if (!(erro instanceof ErroApi)) throw erro
      r = resposta(erro.status, { erro: { codigo: erro.codigo, mensagem: erro.message } })
    }
    writeFileAtomic(arquivo, JSON.stringify({ hash: fingerprint, resposta: r }))
    return r
  })
}
