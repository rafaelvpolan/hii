import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cardsDir } from '../cordel/alicerce/config.ts'
import { idValido } from '../oswaldo/orquestracao/contrato.ts'
import { ocultarSegredos } from '../oswaldo/orquestracao/evidencias.ts'

// Inclui chaves JSON e credenciais em URL, comuns no stderr dos CLIs.
export function redigirDiagnostico(texto: string): string {
  return ocultarSegredos(texto)
    .replace(/(["']?(?:(?:access|refresh|id)[_-]?token|client[_-]?secret|token|password|secret|api[_-]?key|authorization)["']?\s*[=:]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}\]]+)/gi, '$1"[REDACTED]"')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/\b(?:sk|ghp|github_pat)-?[A-Za-z0-9_-]{20,}\b/g, '[REDACTED]')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')
}

export function resumoDoDiagnostico(texto: string, limite = 180): string {
  const limpo = redigirDiagnostico(texto).replace(/\s+/g, ' ').trim()
  return limpo.length > limite ? `${limpo.slice(0, limite - 1)}…` : limpo
}

export function gravarDiagnostico(id: string, dados: Record<string, string>): string {
  if (!idValido(id)) throw new Error('ID de diagnostico invalido')
  const dir = join(cardsDir(), 'diagnosticos')
  try {
    mkdirSync(dir, { recursive: true })
    const arquivo = join(dir, `${id}-${randomUUID()}.diagnostico.json`)
    const seguro = Object.fromEntries(Object.entries(dados).map(([chave, valor]) => [chave, redigirDiagnostico(valor)]))
    writeFileSync(arquivo, JSON.stringify({ versao: 1, tarefa: id, instante: new Date().toISOString(), ...seguro }, null, 2) + '\n', { mode: 0o600 })
    return arquivo
  } catch {
    // A observabilidade nao pode impedir retomada nem perder trabalho pago.
    return ''
  }
}
