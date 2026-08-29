import type { DispatchIO } from '../../motor/mirante/despacho.ts'

function naoProvido(nome: string): never {
  throw new Error(`DispatchIO.${nome} nao foi provido por este teste`)
}

export function dispatchIOFalso(parcial: Partial<DispatchIO> = {}): DispatchIO {
  return {
    log: () => {},
    dim: (texto) => texto,
    color: false,
    largura: () => 78,
    responder: () => naoProvido('responder'),
    plano: async () => [],
    daemonOnline: () => true,
    iaProntaParaEnviar: () => ({ ok: true, motivo: '' }),
    ...parcial,
  }
}
