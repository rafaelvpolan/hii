import { test, expect } from 'bun:test'
import { createApp } from '../motor/mir/tui/app'
import type { Terminal } from '../motor/mir/tui/screen'

interface Fake extends Terminal {
  tecla: (k: string) => void
  saida: string[]
}

function fakeTerminal(): Fake {
  const saida: string[] = []
  let onKeyFn: ((k: string) => void) | null = null
  return {
    saida,
    write: (s) => { saida.push(s) },
    rows: () => 16,
    cols: () => 60,
    onResize: () => {},
    offResize: () => {},
    onKey: (fn) => { onKeyFn = fn },
    offKey: () => { onKeyFn = null },
    setRaw: () => {},
    tecla: (k) => onKeyFn?.(k),
  }
}

function app(term: Fake, onLine: (l: string) => void): ReturnType<typeof createApp> {
  return createApp(term, {
    header: () => 'hii', corpo: () => [], dica: () => '', prompt: () => '› ',
    legenda: () => '', rodape: () => [], onComplete: () => [], onInterrupt: () => true,
    intervalMs: 100000, onLine,
  })
}

test('REGRESSAO encerrar() resolve o run() — a TUI tem terminador alem de ctrl+c e eof', async () => {
  const t = fakeTerminal()
  const a = app(t, () => {})
  const fim = a.run()
  a.encerrar()
  await expect(fim).resolves.toBeUndefined()
})

test('REGRESSAO /exit digitado na TUI encerra de verdade, nao vira no-op', async () => {
  const t = fakeTerminal()
  let a: ReturnType<typeof createApp> | null = null
  a = app(t, (linha) => { if (linha.trim() === '/exit') a?.encerrar() })
  const fim = a.run()
  for (const c of '/exit') t.tecla(c)
  t.tecla('\r')
  await expect(fim).resolves.toBeUndefined()
})

test('encerrar() duas vezes nao quebra', async () => {
  const t = fakeTerminal()
  const a = app(t, () => {})
  const fim = a.run()
  a.encerrar()
  a.encerrar()
  await expect(fim).resolves.toBeUndefined()
})
