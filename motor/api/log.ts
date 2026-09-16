import { closeSync, openSync, readSync, fstatSync } from 'node:fs'
import { join } from 'node:path'
import { cardsDir } from '../cordel/alicerce/config.ts'
import { ErroApi } from './contrato.ts'

export function lerLog(id: string, offset: number): { texto: string; proximo: number; reset: boolean } {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new ErroApi(400, 'offset_invalido', 'offset deve ser inteiro nao negativo')
  let fd: number
  try { fd = openSync(join(cardsDir(), 'runs', `${id}.live.log`), 'r') } catch {
    return { texto: '', proximo: 0, reset: offset > 0 }
  }
  try {
    const tamanho = fstatSync(fd).size
    const reset = offset > tamanho
    const inicio = reset ? 0 : offset
    const buffer = Buffer.alloc(Math.min(65536, tamanho - inicio))
    let n = readSync(fd, buffer, 0, buffer.length, inicio)
    // Nao corte uma sequencia UTF-8 entre duas respostas.
    if (inicio + n < tamanho) {
      let i = n - 1
      while (i >= 0 && ((buffer[i] ?? 0) & 0xc0) === 0x80) i--
      const b = buffer[i] ?? 0
      const bytes = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1
      if (n - i < bytes) n = i
    }
    return { texto: buffer.subarray(0, n).toString('utf8'), proximo: inicio + n, reset }
  } finally { closeSync(fd) }
}
