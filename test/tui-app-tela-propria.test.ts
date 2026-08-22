import { test, expect, beforeEach } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../lib/core/tui/app'
import type { Terminal } from '../lib/core/tui/screen'
import { telaVirtual } from './fixtures/tela-virtual'
import { navegarNaTela, alvoDeEntrada } from '../bin/lib/board-tui'
import { selecionado, selecionar } from '../bin/lib/estado'
import { providerNameFor } from '../lib/ai/registry'
import { aplicar as aplicarIa, ciclarModo } from '../lib/core/escolher-ia'
import { newSession } from '../lib/core/session'

beforeEach(() => {
  process.env.HICODE_IA_FILE = join(mkdtempSync(join(tmpdir(), 'hii-tela-cfg-')), 'ia.json')
})

interface Fake extends Terminal {
  saida: string[]
  tecla: (k: string) => void
  tela: () => string
}

function fakeTerminal(rows = 16, cols = 60): Fake {
  const saida: string[] = []
  let onKeyFn: ((k: string) => void) | null = null
  return {
    saida,
    write: (s) => { saida.push(s) },
    rows: () => rows,
    cols: () => cols,
    onResize: () => {},
    offResize: () => {},
    onKey: (fn) => { onKeyFn = fn },
    offKey: () => { onKeyFn = null },
    setRaw: () => {},
    tecla: (k) => onKeyFn?.(k),
    tela: () => telaVirtual(saida),
  }
}

function app(term: Fake, over: Partial<Parameters<typeof createApp>[1]> = {}): ReturnType<typeof createApp> {
  return createApp(term, {
    header: () => 'hii',
    corpo: () => ['IAS'],
    dica: () => '',
    prompt: () => '› ',
    legenda: () => '',
    onLine: () => {},
    onComplete: () => [],
    onInterrupt: () => true,
    rodape: () => [],
    intervalMs: 100000,
    telaPropria: () => true,
    ...over,
  })
}

test('esc na tela propria sai dela sem encerrar o app, e preserva o log de antes', () => {
  const t = fakeTerminal()
  let emConfig = true
  let saiu = false
  const a = app(t, {
    telaPropria: () => emConfig,
    sairDaTela: () => { emConfig = false; saiu = true },
  })
  void a.run()
  a.log('  ruido anterior')
  t.tecla('\x1b')
  expect(saiu).toBe(true)
  expect(t.saida.join('')).not.toContain('\x1b[?1049l')
  a.log('  depois de sair')
  expect(t.tela()).toContain('ruido anterior')
  expect(t.tela()).toContain('depois de sair')
})

test('ctrl+c na tela propria sai dela em vez de encerrar a sessao', () => {
  const t = fakeTerminal()
  let emConfig = true
  const chamadas: string[] = []
  void app(t, {
    telaPropria: () => emConfig,
    sairDaTela: () => { emConfig = false; chamadas.push('sairDaTela') },
    onInterrupt: () => { chamadas.push('onInterrupt'); return true },
  }).run()
  t.tecla('\x03')
  expect(chamadas).toEqual(['sairDaTela'])
})

test('setas na tela propria navegam entre provedores, nao no historico', () => {
  const t = fakeTerminal()
  const direcoes: number[] = []
  void app(t, {
    onNav: (dir) => { direcoes.push(dir); return true },
  }).run()
  t.tecla('\x1b[B')
  t.tecla('\x1b[A')
  expect(direcoes).toEqual([1, -1])
})

test('enter na tela propria aplica a escolha, sem enviar linha', () => {
  const t = fakeTerminal()
  const linhas: string[] = []
  let entrou = false
  void app(t, {
    onEntrar: () => { entrou = true },
    onLine: (l) => { linhas.push(l) },
  }).run()
  t.tecla('\r')
  expect(entrou).toBe(true)
  expect(linhas).toEqual([])
})

test('digitar na tela propria nao entra no buffer — some mesmo depois de sair da tela', () => {
  const t = fakeTerminal()
  let emConfig = true
  const a = app(t, {
    telaPropria: () => emConfig,
    sairDaTela: () => { emConfig = false },
  })
  void a.run()
  for (const c of 'oi') t.tecla(c)
  expect(t.tela()).not.toContain('oi')
  t.tecla('\x1b')
  expect(t.tela()).not.toContain('oi')
})

test('shift+tab na tela propria cicla o modo de operacao da ia ativa, sem entrar em navegacao', () => {
  const t = fakeTerminal()
  const direcoes: number[] = []
  const navs: Array<{ dir: -1 | 1; modo: string }> = []
  void app(t, {
    onCiclarModo: (dir) => { direcoes.push(dir) },
    onNav: (dir, modo) => { navs.push({ dir, modo }); return true },
  }).run()
  t.tecla('\x1b[Z')
  expect(direcoes).toEqual([1])
  expect(navs).toEqual([])
})

test('shift+tab nao deixa nenhuma navegacao pendente — a seta seguinte entra direto no rodape', () => {
  const t = fakeTerminal()
  const navs: Array<{ dir: -1 | 1; modo: string }> = []
  void app(t, {
    telaPropria: () => false,
    onCiclarModo: () => {},
    onNav: (dir, modo) => { navs.push({ dir, modo }); return true },
  }).run()
  t.tecla('\x1b[Z')
  t.tecla('\x1b[B')
  expect(navs).toEqual([{ dir: 1, modo: 'rodape' }])
})

test('pgdn na tela propria rola para baixo a partir do topo do conteudo', () => {
  const t = fakeTerminal(10, 40)
  const linhas = Array.from({ length: 30 }, (_, i) => `linha ${i}`)
  void app(t, { corpo: () => linhas }).run()
  expect(t.tela()).toContain('linha 0')
  expect(t.tela().includes('linha 29')).toBe(false)
  t.tecla('\x1b[6~')
  expect(t.tela()).not.toContain('linha 0')
})

test('REGRESSAO: dentro do /config, shift+tab cicla o modo sem mexer na navegacao de provedor da tela', () => {
  const t = fakeTerminal()
  const state = { ...newSession('org/app'), tela: 'config' as const }
  selecionar('')
  aplicarIa({ papeis: ['implement'], provider: 'codex' })
  const modos: number[] = []
  void app(t, {
    onNav: (dir, modo) => navegarNaTela(state, dir, modo),
    onEntrar: (modo) => {
      const alvo = alvoDeEntrada(modo, state)
      if (alvo.kind === 'provedor') aplicarIa({ papeis: ['implement'], provider: alvo.nome })
    },
    onCiclarModo: (dir) => { modos.push(dir); ciclarModo('implement', dir) },
  }).run()

  t.tecla('\x1b[B')
  const alvoDaSeta = selecionado()

  t.tecla('\x1b[Z')
  expect(modos).toEqual([1])
  expect(selecionado()).toBe(alvoDaSeta)

  t.tecla('\r')
  expect(providerNameFor('implement') as string).toBe(alvoDaSeta)
})

test('REGRESSAO: com dica preenchida, a primeira linha do corpo nao some da tela propria', () => {
  const t = fakeTerminal(10, 40)
  const linhas = Array.from({ length: 30 }, (_, i) => `linha ${i}`)
  void app(t, { corpo: () => linhas, dica: () => 'dica nao vazia' }).run()
  expect(t.tela()).toContain('linha 0')
})

test('REGRESSAO na tela propria a seta nunca chega como ajustes ou board — sempre navega a propria tela', () => {
  const t = fakeTerminal()
  const navs: Array<{ dir: -1 | 1; modo: string }> = []
  void app(t, {
    onCiclarModo: () => {},
    onNav: (dir, modo) => { navs.push({ dir, modo }); return true },
  }).run()
  for (const k of ['\x1b[Z', '\t', '\x1b[D', '\x1b[B', '\x1b[A']) t.tecla(k)
  expect(navs).toEqual([{ dir: 1, modo: '' }, { dir: -1, modo: '' }])
})
