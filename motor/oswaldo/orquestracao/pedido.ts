import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

export interface PedidoOrquestrado {
  titulo: string
  descricao: string
}

function objetivoSeguro(texto: string): string {
  // Titulos do spec nao podem virar secoes internas do card Markdown.
  return texto.replace(/^##(?=\s|$)/gm, '> ##')
}

export async function lerPedidoOrquestrado(texto: string, projeto: string): Promise<PedidoOrquestrado> {
  const pedido = texto.trim()
  if (!pedido || ['on', 'off'].includes(pedido)) throw new Error('uso: /hii <tarefa ou arquivo.spec>')
  const entreAspas = (pedido.startsWith('"') && pedido.endsWith('"')) || (pedido.startsWith("'") && pedido.endsWith("'"))
  const caminho = entreAspas ? pedido.slice(1, -1) : pedido
  const arquivoSpec = /\.spec(?:\.md)?$/i.test(caminho)
    && (entreAspas || !/\s/.test(caminho) || /^(?:\.?\.?\/)/.test(caminho))
  if (!arquivoSpec) return { titulo: pedido, descricao: objetivoSeguro(pedido) }
  const absoluto = resolve(projeto, caminho)
  const arquivo = await open(absoluto, constants.O_RDONLY | constants.O_NONBLOCK)
    .catch(() => { throw new Error(`nao foi possivel abrir o spec: ${caminho}`) })
  try {
    if (!(await arquivo.stat()).isFile()) throw new Error('o spec deve ser um arquivo regular')
    const limite = 1024 * 1024
    const buffer = Buffer.alloc(limite + 1)
    let tamanho = 0
    while (tamanho < buffer.length) {
      const { bytesRead } = await arquivo.read(buffer, tamanho, buffer.length - tamanho, null)
      if (!bytesRead) break
      tamanho += bytesRead
    }
    if (tamanho > limite) throw new Error('spec excede o limite de 1 MiB; divida o pedido')
    const conteudo = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, tamanho))
    if (!conteudo.trim() || conteudo.includes('\0')) throw new Error('spec vazio ou com conteudo binario')
    return { titulo: basename(caminho), descricao: `Especificacao: ${caminho}\n\n${objetivoSeguro(conteudo)}` }
  } finally { await arquivo.close() }
}
