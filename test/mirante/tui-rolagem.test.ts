import { test, expect } from '../apoio/runner.ts'
import { createApp } from '../../motor/mirante/tui/app.ts'
import type { Terminal } from '../../motor/mirante/tui/screen.ts'
import type { App } from '../../motor/mirante/tui/app.ts'
import { telaVirtual } from '../fixtures/tela-virtual.ts'

const PG_UP = '\x1b[5~'
const PG_DOWN = '\x1b[6~'
const MARCA = 'mais novas abaixo'

interface Bancada {
  app: App
  tecla: (k: string) => void
  quadro: () => string
  fim: () => void
}

function bancada(): Bancada {
  const saida: string[] = []
  let onKey: ((k: string) => void) | null = null
  let repintar: (() => void) | null = null
  const term: Terminal = {
    write: (s) => { saida.push(s) },
    rows: () => 24,
    cols: () => 80,
    onResize: (fn) => { repintar = fn },
    offResize: () => { repintar = null },
    onKey: (fn) => { onKey = fn },
    offKey: () => { onKey = null },
    setRaw: () => {},
  }
  const app = createApp(term, {
    header: () => 'hii',
    corpo: () => [],
    dica: () => '',
    prompt: () => '› ',
    legenda: () => '',
    rodape: () => [],
    intervalMs: 1_000_000,
    onComplete: () => [],
    onInterrupt: () => true,
    onNav: () => false,
    onEntrar: () => {},
    onAba: () => {},
    onCiclarModo: () => {},
    podeLimpar: () => '',
    fixo: () => [],
    sugestoes: () => [],
    prefixoComum: () => '',
    onLine: async () => {},
  })
  void app.run()
  return {
    app,
    tecla: (k) => onKey?.(k),
    quadro: () => {
      saida.length = 0
      repintar?.()
      return telaVirtual(saida)
    },
    fim: () => { onKey?.('\x04') },
  }
}

function comLinhas(quantas: number): Bancada {
  const b = bancada()
  for (let i = 1; i <= quantas; i++) b.app.log(`  linha-${i}`)
  return b
}

test('sem rolagem a area mostra o fim do log, como antes', () => {
  const b = comLinhas(60)
  const q = b.quadro()
  expect(q).toContain('linha-60')
  expect(q).not.toContain('linha-1 ')
  expect(q).not.toContain(MARCA)
  b.fim()
})

test('pgup sobe no log e avisa que a tela nao esta no vivo', () => {
  const b = comLinhas(60)
  b.tecla(PG_UP)
  const q = b.quadro()
  expect(q).toContain(MARCA)
  expect(q).not.toContain('linha-60')
  expect(q).toContain('linha-4')
  b.fim()
})

test('pgdn volta ao vivo e a marca sai', () => {
  const b = comLinhas(60)
  b.tecla(PG_UP)
  b.tecla(PG_DOWN)
  const q = b.quadro()
  expect(q).toContain('linha-60')
  expect(q).not.toContain(MARCA)
  b.fim()
})

test('linha nova no log traz a tela de volta ao vivo sozinha', () => {
  const b = comLinhas(60)
  b.tecla(PG_UP)
  expect(b.quadro()).toContain(MARCA)
  b.app.log('  chegou agora')
  const q = b.quadro()
  expect(q).toContain('chegou agora')
  expect(q).not.toContain(MARCA)
  b.fim()
})

test('rolar demais para cima para no topo, sem quebrar o quadro', () => {
  const b = comLinhas(60)
  for (let i = 0; i < 20; i++) b.tecla(PG_UP)
  const q = b.quadro()
  expect(q).toContain('linha-1')
  expect(q).toContain(MARCA)
  b.tecla(PG_DOWN)
  expect(b.quadro()).toContain('linha-2')
  b.fim()
})

test('rolar sem log suficiente nao muda nada', () => {
  const b = comLinhas(3)
  b.tecla(PG_UP)
  const q = b.quadro()
  expect(q).toContain('linha-3')
  expect(q).not.toContain(MARCA)
  b.fim()
})

test('limpar a area zera a rolagem', () => {
  const b = comLinhas(60)
  b.tecla(PG_UP)
  b.app.limparLog()
  const q = b.quadro()
  expect(q).not.toContain(MARCA)
  expect(q).not.toContain('linha-')
  b.fim()
})
