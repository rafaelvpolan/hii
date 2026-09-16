import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type EstadoDoUso = 'conhecido' | 'esgotado' | 'expirado' | 'desconhecido'

// Mesmo formato persistido pelo CLI: nenhum leitor ou estado da TUI e simulado.
// O leitor real tem cache de 2s. Quem observa outro processo deve esperar seus
// sinais de tela (polling de 400ms, prazo >=6s), nao a leitura local do driver.
export function semearUsoCodex(base: string, estado: EstadoDoUso, agoraMs = Date.now()): void {
  const raiz = join(base, 'codex')
  const sessoes = join(raiz, 'sessions', 'e2e')
  mkdirSync(sessoes, { recursive: true })
  writeFileSync(join(raiz, 'auth.json'), '{}\n')
  const expirado = estado === 'expirado'
  const oitoDias = 8 * 86400000
  const evento = {
    timestamp: new Date(expirado ? agoraMs - oitoDias : agoraMs - 60000).toISOString(),
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: { last_token_usage: { total_tokens: 25840 }, model_context_window: 258400 },
      rate_limits: {
        plan_type: 'plus',
        primary: { used_percent: estado === 'conhecido' ? 42 : 100, window_minutes: 300,
          resets_at: Math.floor((agoraMs + (expirado ? -3600000 : 2 * 3600000)) / 1000) },
        secondary: { used_percent: estado === 'conhecido' ? 18 : 100, window_minutes: 10080,
          resets_at: Math.floor((agoraMs + (expirado ? -86400000 : 5 * 86400000)) / 1000) },
      },
    },
  }
  const arquivo = join(sessoes, 'uso.jsonl')
  // Substituicao atomica evita uma repintura observar JSON parcialmente escrito.
  writeFileSync(`${arquivo}.tmp`, estado === 'desconhecido' ? '' : JSON.stringify(evento) + '\n')
  renameSync(`${arquivo}.tmp`, arquivo)
}
