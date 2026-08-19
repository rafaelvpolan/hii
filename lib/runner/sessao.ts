let atual = ''

function novoId(agoraMs = Date.now()): string {
  const ts = new Date(agoraMs).toISOString().replace(/[^0-9]/g, '').slice(0, 14)
  return `${ts}-${process.pid}`
}

export function sessaoAtual(): string {
  if (!atual) atual = novoId()
  return atual
}

export function reiniciarSessao(): string {
  atual = novoId()
  return atual
}

export function definirSessao(id: string): void {
  atual = id
}
