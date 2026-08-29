import { test, expect, beforeAll, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../../motor/mirante/tui/app.ts'
import { renderFrame } from '../../motor/mirante/tui/layout.ts'
import { visibleLen } from '../../motor/mirante/tui/layout.ts'
import { COMMANDS, ALIASES, handle, newSession } from '../../motor/mirante/sessao.ts'
import type { SessionState } from '../../motor/mirante/sessao.ts'
import { dispatch } from '../../motor/mirante/despacho.ts'
import { dispatchIOFalso } from '../fixtures/dispatch-io-falso.ts'
import type { Terminal } from '../../motor/mirante/tui/screen.ts'

// MIR — o percurso completo. Cobertura de comportamento ja existe em ~50
// arquivos; o que faltava era o passeio que atravessa TUDO de uma vez e prova
// que nenhuma combinacao de comando, estado e tamanho de terminal escapa uma
// excecao ou pinta um quadro torto.
//
// A diferenca para os testes de unidade ao lado: eles conferem um caminho por
// vez, com o resto parado. Travamento e quadro quebrado quase nunca nascem de um
// caminho — nascem de uma combinacao que ninguem pensou em montar.

// O percurso chama dispatch() para TODO comando, e alguns criam card. Sem
// isolar, o passeio escreveria no cards/ de verdade do desenvolvedor —
// test/isolamento-de-testes.test.ts reprova exatamente isso, e pegou este
// arquivo na primeira rodada.
let BASE_CARDS = ''
beforeAll(() => {
  BASE_CARDS = mkdtempSync(join(tmpdir(), 'hicode-percurso-'))
  mkdirSync(join(BASE_CARDS, 'runs'), { recursive: true })
  process.env.HICODE_CARDS_DIR = BASE_CARDS
})
afterAll(() => {
  delete process.env.HICODE_CARDS_DIR
  rmSync(BASE_CARDS, { recursive: true, force: true })
})

interface Fake extends Terminal {
  saida: string[]
  tecla: (k: string) => void
}

function fakeTerminal(rows: number, cols: number): Fake {
  const saida: string[] = []
  let onKeyFn: ((k: string) => void) | null = null
  return {
    saida,
    write: (s) => { saida.push(s) },
    rows: () => rows,
    cols: () => cols,
    onResize: () => {}, offResize: () => {},
    onKey: (fn) => { onKeyFn = fn },
    offKey: () => { onKeyFn = null },
    setRaw: () => {},
    tecla: (k) => onKeyFn?.(k),
  }
}

const ESTADOS: ReadonlyArray<readonly [string, SessionState]> = [
  ['inicial', newSession('org/app')],
  ['plano pendente', { ...newSession('org/app'), pendingPlan: '12' }],
  ['perguntando', { ...newSession('org/app'), perguntando: '12' }],
  ['removendo', { ...newSession('org/app'), removendo: '12' }],
  ['retomando', { ...newSession('org/app'), retomando: '12' }],
  ['escolhendo repo', { ...newSession('org/app'), escolhendo: true }],
  ['aprovando', { ...newSession('org/app'), aprovando: '12' }],
  ['comentando', { ...newSession('org/app'), comentando: '12' }],
  ['seguindo tarefa', { ...newSession('org/app'), seguindo: '12' }],
  ['tela de config', { ...newSession('org/app'), tela: 'config' }],
  ['sem repo', newSession('')],
]

const ENTRADAS: readonly string[] = [
  ...COMMANDS,
  ...Object.values(ALIASES).flat(),
  '', '   ', 'texto livre virando tarefa', '#42', '42', '1', '2', '3',
  'n', 'nao', 'cancelar', '/comando-que-nao-existe', '/', '//',
  '/stop', '/stop 12', '/stop 12 motivo escrito',
  '/rm', '/rm 12', '/rm 12 13 --force',
  '/new-task', '/new-task mudar o botao', '/new-ask', '/new-ask por que isso',
  '/repo', '/repo org/outro', '/ref', '/ref caminho.png',
  '中文 emoji 😀 na entrada', 'a'.repeat(500),
]

// Tamanhos: do terminal impossivel ao painel largo. 1 linha e 1 coluna nao sao
// hipotese — e o que acontece quando alguem arrasta a divisoria ate o fim.
const LAYOUTS: ReadonlyArray<readonly [number, number]> = [
  [1, 1], [1, 24], [2, 20], [3, 40], [4, 24], [5, 12],
  [12, 50], [24, 80], [40, 120], [50, 200], [200, 400],
]

test('PERCURSO nenhuma combinacao de entrada x estado LANCA no reducer da sessao', () => {
  const quebras: string[] = []
  for (const [nome, estado] of ESTADOS) {
    for (const entrada of ENTRADAS) {
      try {
        const r = handle(entrada, estado)
        if (!r.effect.kind) quebras.push(`${nome} + ${JSON.stringify(entrada).slice(0, 30)}: efeito sem kind`)
      } catch (e) {
        quebras.push(`${nome} + ${JSON.stringify(entrada).slice(0, 30)}: ${String((e as Error).message).slice(0, 80)}`)
      }
    }
  }
  expect(quebras).toEqual([])
})

test('PERCURSO o reducer nunca devolve estado sem os campos que a TUI le', () => {
  const chaves = Object.keys(newSession()).sort()
  const faltando: string[] = []
  for (const [nome, estado] of ESTADOS) {
    for (const entrada of ENTRADAS) {
      const r = handle(entrada, estado)
      const atual = Object.keys(r.state).sort()
      for (const k of chaves) {
        if (!atual.includes(k)) faltando.push(`${nome} + ${entrada}: sem "${k}"`)
      }
    }
  }
  expect(faltando, 'campo sumindo do estado vira undefined na pintura e quebra o quadro').toEqual([])
})

test('PERCURSO todo comando atravessa o despachante sem LANCAR, em todo estado', async () => {
  const io = dispatchIOFalso()
  const quebras: string[] = []
  for (const [nome, estado] of ESTADOS) {
    for (const cmd of COMMANDS) {
      const r = handle(cmd, estado)
      try {
        await dispatch(r.effect, r.state, io)
      } catch (e) {
        quebras.push(`${nome} + ${cmd}: ${String((e as Error).message).slice(0, 90)}`)
      }
    }
  }
  expect(quebras).toEqual([])
})

const QUADRO_BASE = {
  header: 'hii · org/app · daemon online',
  corpo: ['#020 selo beta', '#021 outra tarefa', '中文 😀 linha larga'],
  input: 'texto', cursor: 3, dica: '/help para ajuda', prompt: '› ',
  rodape: ['rodape 1', 'rodape 2'],
}

test('PERCURSO em TODO layout o quadro fecha com largura uniforme e cursor dentro', () => {
  const quebras: string[] = []
  for (const [rows, cols] of LAYOUTS) {
    for (const legenda of [undefined, 'entrada']) {
      for (const input of ['', 'uma linha', 'duas\nlinhas', 'a'.repeat(300), '中文😀']) {
        const f = renderFrame({ ...QUADRO_BASE, rows, cols, legenda, input, cursor: input.length })
        const larguraEsperada = Math.max(24, cols)
        const larguras = [...new Set(f.lines.map(l => visibleLen(l)))]
        if (larguras.length > 1 || (larguras[0] !== undefined && larguras[0] !== larguraEsperada)) {
          quebras.push(`${rows}x${cols} legenda=${String(legenda)}: larguras ${JSON.stringify(larguras)}, esperado ${larguraEsperada}`)
        }
        if (f.lines.length > Math.max(rows, 4) + 2) {
          quebras.push(`${rows}x${cols}: ${f.lines.length} linhas para ${rows} de altura`)
        }
        if (f.cursorRow < 1 || f.cursorCol < 1) {
          quebras.push(`${rows}x${cols}: cursor fora da tela (${f.cursorRow},${f.cursorCol})`)
        }
      }
    }
  }
  expect(quebras).toEqual([])
})

test('PERCURSO a TUI real atravessa comandos, navegacao e modos sem LANCAR', async () => {
  const term = fakeTerminal(24, 80)
  const linhas: string[] = []
  const app = createApp(term, {
    header: () => 'hii · org/app',
    corpo: () => ['#020 selo beta', '#021 outra'],
    dica: () => '/help',
    prompt: () => '› ',
    legenda: () => '',
    rodape: () => ['rodape'],
    onLine: (l) => { linhas.push(l) },
    onComplete: () => ['/help', '/config'],
    onInterrupt: () => true,
    onNav: () => true,
    onEntrar: () => {},
    onAba: () => {},
    onCiclarModo: () => {},
    podeLimpar: () => '',
    intervalMs: 10_000,
  })
  const rodando = app.run()

  const TECLAS = [
    '/', 'h', 'e', 'l', 'p', '\r',            // digitar e enviar um comando
    '\t',                                      // autocompletar
    '\x1b[A', '\x1b[B', '\x1b[C', '\x1b[D',    // setas
    '\x1b[Z',                                  // shift-tab
    '\x1b[5~', '\x1b[6~',                      // page up/down
    '\x1b', '\x0c',                            // esc, ctrl-L
    '\x7f', '\x08',                            // backspace
    '\x01', '\x05',                            // home/fim
    '\x1b[200~texto colado\x1b[201~',          // colagem marcada
    'rajada sem marcador de colagem',
    '中文😀',                                   // largura dupla
    '\r',
  ]
  expect(() => { for (const k of TECLAS) term.tecla(k) }).not.toThrow()
  app.encerrar()
  await rodando
  expect(term.saida.length, 'a TUI nao pintou nada — o percurso nao exercitou o app').toBeGreaterThan(0)
})

test('PERCURSO redimensionar entre todos os layouts nao quebra a pintura seguinte', () => {
  let anterior: string[] = []
  const quebras: string[] = []
  for (const [rows, cols] of [...LAYOUTS, ...[...LAYOUTS].reverse()]) {
    const f = renderFrame({ ...QUADRO_BASE, rows, cols })
    // Toda linha do quadro novo tem de estar completa: redimensionar nao pode
    // deixar resto do quadro anterior em nenhuma linha.
    for (const l of f.lines) {
      if (visibleLen(l) !== Math.max(24, cols)) quebras.push(`${rows}x${cols}: linha com ${visibleLen(l)} colunas`)
    }
    anterior = f.lines
  }
  expect(quebras).toEqual([])
  expect(anterior.length).toBeGreaterThan(0)
})
