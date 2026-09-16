import { test, expect, beforeEach } from '../apoio/runner.ts'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../../motor/mirante/tui/app.ts'
import type { Terminal } from '../../motor/mirante/tui/screen.ts'
import { telaVirtual } from '../fixtures/tela-virtual.ts'
import { navegarNaTela, alvoDeEntrada } from '../../motor/mirante/cli/board-tui.ts'
import { selecionado, selecionar } from '../../motor/mirante/cli/estado.ts'
import { providerNameFor } from '../../motor/tomada/registro.ts'
import { aplicar as aplicarIa, ciclarModo } from '../../motor/mirante/escolher-ia.ts'
import { newSession } from '../../motor/mirante/sessao.ts'

beforeEach(() => {
  process.env.HII_IA_FILE = join(mkdtempSync(join(tmpdir(), 'hii-tela-cfg-')), 'ia.json')
})

interface Fake extends Terminal {
  saida: string[]
  tecla: (k: string) => void
  tela: () => string
  resize: (rows: number, cols: number) => void
}

function fakeTerminal(rows = 16, cols = 60): Fake {
  const saida: string[] = []
  let onKeyFn: ((k: string) => void) | null = null
  const resizeFns = new Set<() => void>()
  return {
    saida,
    write: (s) => { saida.push(s) },
    rows: () => rows,
    cols: () => cols,
    onResize: fn => { resizeFns.add(fn) },
    offResize: fn => { resizeFns.delete(fn) },
    onKey: (fn) => { onKeyFn = fn },
    offKey: () => { onKeyFn = null },
    setRaw: () => {},
    tecla: (k) => onKeyFn?.(k),
    tela: () => telaVirtual(saida, cols),
    resize: (altura, largura) => { rows = altura; cols = largura; for (const fn of resizeFns) fn() },
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

for (const [cols, rows] of [[48, 24], [80, 24], [120, 40]] as const) {
  test(`REGRESSAO #53: pgdn percorre todo o config ${cols}x${rows} sem saltar campos`, () => {
    const t = fakeTerminal(rows, cols)
    const linhas = Array.from({ length: 90 }, (_, i) => `campo-${String(i).padStart(3, '0')}-fim`)
    const a = app(t, { corpo: () => linhas, dica: () => 'pgup/pgdn rola · esc sai', rodape: () => ['estado', 'ia configurada', 'execucao'] })
    void a.run()
    const vistos = new Set<string>()
    try {
      for (let i = 0; i < 30; i++) {
        for (const campo of t.tela().match(/campo-\d{3}-fim/g) ?? []) vistos.add(campo)
        expect(t.tela()).toContain('›')
        t.tecla('\x1b[6~')
      }
      expect([...vistos].sort()).toEqual(linhas)
    } finally { a.encerrar() }
  })
}

test('REGRESSAO #53: resize recalcula config imediatamente sem esperar tick nem tecla', () => {
  const t = fakeTerminal(24, 48)
  const a = app(t, { corpo: () => [`largura atual ${t.cols()}`, ...Array.from({ length: 50 }, (_, i) => `linha ${i}`)] })
  void a.run()
  try {
    expect(t.tela()).toContain('largura atual 48')
    t.resize(40, 120)
    expect(t.tela()).toContain('largura atual 120')
    t.resize(24, 80)
    expect(t.tela()).toContain('largura atual 80')
  } finally { a.encerrar() }
})

test('config reserva o prompt, preserva rascunho e devolve foco de entrada com Esc', () => {
  const t = fakeTerminal(24, 48)
  let emConfig = false
  const a = app(t, { telaPropria: () => emConfig, sairDaTela: () => { emConfig = false } })
  void a.run()
  try {
    t.tecla('rascunho preservado')
    expect(t.tela()).toContain('rascunho preservado')
    emConfig = true
    a.log('atualizacao')
    expect(t.tela()).toContain('›')
    expect(t.tela()).not.toContain('rascunho preservado')
    t.tecla('nao enviado')
    t.tecla('\x1b')
    expect(t.tela()).toContain('rascunho preservado')
    expect(t.tela()).not.toContain('nao enviado')
  } finally { a.encerrar() }
})

test('escolher outra ia apos rolar config retorna a selecao visivel', () => {
  const t = fakeTerminal(24, 48)
  let nome = 'claude'
  const a = app(t, {
    corpo: () => [`selecionada: ${nome}`, ...Array.from({ length: 80 }, (_, i) => `campo ${i}`)],
    onNav: () => { nome = 'codex'; return true },
  })
  void a.run()
  try {
    t.tecla('\x1b[6~')
    expect(t.tela()).not.toContain('selecionada: claude')
    t.tecla('\x1b[B')
    expect(t.tela()).toContain('selecionada: codex')
    expect(t.tela()).toContain('›')
  } finally { a.encerrar() }
})
