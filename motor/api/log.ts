import { closeSync, openSync, readFileSync, fstatSync, constants, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { cardsDir } from '../cordel/alicerce/config.ts'
import { ErroApi } from './contrato.ts'

export function lerLog(id: string, offset: number): { texto: string; proximo: number; reset: boolean } {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new ErroApi(400, 'offset_invalido', 'offset deve ser inteiro nao negativo')
  let fd: number
  try {
    if (realpathSync(join(cardsDir(), 'runs')) !== join(realpathSync(cardsDir()), 'runs')) throw new Error('diretorio de log fora da raiz')
    fd = openSync(join(cardsDir(), 'runs', `${id}.live.log`), constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch {
    return { texto: '', proximo: 0, reset: offset > 0 }
  }
  try {
    const tamanho = fstatSync(fd).size
    if (tamanho > 4 * 1024 * 1024) throw new ErroApi(413, 'log_grande', 'use a saida estruturada da observabilidade; log legado excede limite de redacao segura')
    // Redigir ANTES de fatiar: um segredo pode atravessar a borda de 64 KiB.
    // A mascara conserva bytes para nao alterar o cursor do cliente v1.
    let completo = readFileSync(fd, 'utf8')
    const mascara = (s: string): string => '*'.repeat(Buffer.byteLength(s))
    for (const [nome, valor] of Object.entries(process.env)) if (/token|secret|password|credential|api.?key|private.?key/i.test(nome) && valor && valor.length >= 4) completo = completo.split(valor).join(mascara(valor))
    completo = completo.replace(/(?:Bearer\s+\S+|(?:access[_-]?token|token|password|secret|api[_-]?key|authorization)["']?\s*[=:]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)|https?:\/\/[^\s/@]+:[^\s/@]+@|\b(?:sk|ghp|github_pat)[_-][A-Za-z0-9_-]{20,})/gi, mascara)
    const seguro = Buffer.from(completo)
    const reset = offset > tamanho
    const inicio = reset ? 0 : offset
    const buffer = seguro.subarray(inicio, inicio + Math.min(65536, tamanho - inicio))
    let n = buffer.length
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
