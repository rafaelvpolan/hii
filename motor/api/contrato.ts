export type Json = null | boolean | number | string | Json[] | { [chave: string]: Json }
export type Objeto = { [chave: string]: Json }

export class ErroApi extends Error {
  readonly status: number
  readonly codigo: string
  constructor(status: number, codigo: string, mensagem: string) {
    super(mensagem)
    this.status = status
    this.codigo = codigo
  }
}

export function objeto(valor: Json): Objeto {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw new ErroApi(400, 'entrada_invalida', 'esperado objeto JSON')
  return valor
}

export function campos(valor: Objeto, permitidos: string[]): void {
  if (Object.keys(valor).some(c => !permitidos.includes(c))) throw new ErroApi(400, 'campo_desconhecido', 'campo nao permitido')
}

export function texto(valor: Objeto, campo: string, obrigatorio = true, limite = 1048576): string {
  const v = valor[campo]
  if (!obrigatorio && v === undefined) return ''
  if (typeof v !== 'string' || !v.trim() || Buffer.byteLength(v) > limite || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v)) {
    throw new ErroApi(400, 'entrada_invalida', `campo ${campo} invalido`)
  }
  return v.trim()
}

export function idValido(id: string): boolean { return /^\d{3,12}$/.test(id) }

export const ACOES = ['aprovar-plano', 'aprovar-url', 'recusar', 'responder', 'parar', 'retomar', 'confirmar-fecho', 'recusar-fecho'] as const
export type AcaoApi = (typeof ACOES)[number]

export function acaoValida(acao: string): acao is AcaoApi { return (ACOES as readonly string[]).includes(acao) }
