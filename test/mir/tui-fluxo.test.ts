import { test, expect, beforeEach } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../../motor/mir/tui/app.ts'
import { handle, newSession, planShown } from '../../motor/mir/sessao.ts'
import { dispatch } from '../../motor/mir/despacho.ts'
import type { Terminal } from '../../motor/mir/tui/screen.ts'
import type { SessionState } from '../../motor/mir/sessao.ts'
import { stripAnsi } from '../../motor/mir/tui/layout.ts'
import { dispatchIOFalso } from '../fixtures/dispatch-io-falso.ts'
import { telaVirtual } from '../fixtures/tela-virtual.ts'

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hicode-tui-'))
  mkdirSync(join(dir, 'runs'), { recursive: true })
  process.env.HICODE_CARDS_DIR = dir
})

function card(id: string, fields: Record<string, string> = {}): void {
  const fm = Object.entries({ id, status: 'READY', title: `tarefa ${id}`, repo: 'org/app', ...fields })
    .map(([k, v]) => `${k}: ${v}`).join('\n')
  writeFileSync(join(dir, `${id}-x.md`), `---\n${fm}\n---\n## Objetivo\nx\n`)
}

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
    rows: () => 24,
    cols: () => 80,
    onResize: () => {},
    offResize: () => {},
    onKey: (fn) => { onKeyFn = fn },
    offKey: () => { onKeyFn = null },
    setRaw: () => {},
    tecla: (k) => onKeyFn?.(k),
  }
}

async function sessao(teclas: string[]): Promise<{ saida: string; state: SessionState }> {
  const term = fakeTerminal()
  let state = newSession('org/app')
  const registro: string[] = []
  const app = createApp(term, {
    header: () => 'hii',
    corpo: () => [],
    dica: () => '',
    prompt: () => '› ',
    legenda: () => '',
    rodape: () => [],
    intervalMs: 100000,
    onComplete: () => [],
    onInterrupt: () => true,
    onNav: () => false,
    onEntrar: () => {},
    onAba: () => {},
    podeLimpar: () => '',
    fixo: () => [],
    sugestoes: () => [],
    prefixoComum: () => '',
    onLine: async (linha) => {
      const r = handle(linha, state)
      state = r.state
      if (r.effect.kind === 'submit') {
        registro.push(`SUBMIT: ${r.effect.text}`)
        state = planShown(state, '999')
        return
      }
      const d = await dispatch(r.effect, state, dispatchIOFalso({
        log: (l) => { registro.push(l); app.log(l) },
      }))
      state = d.state
    },
  })
  const rodando = app.run()
  for (const t of teclas) {
    for (const c of t) term.tecla(c)
    term.tecla('\r')
  }
  await new Promise(r => setTimeout(r, 20))
  term.tecla('\x03')
  await rodando
  return { saida: registro.join('\n'), state }
}

test('FLUXO TUI: /rm mais s apaga o card de verdade', async () => {
  card('027')
  const { saida } = await sessao(['/rm 27', 's'])
  expect(saida).toContain('apagar 1 tarefa')
  expect(saida).toContain('apagada(s)')
  expect(existsSync(join(dir, '027-x.md'))).toBe(false)
})

test('FLUXO TUI: enter confirma a remocao', async () => {
  card('027')
  const { saida } = await sessao(['/rm 27', ''])
  expect(saida).not.toContain('SUBMIT')
  expect(existsSync(join(dir, '027-x.md'))).toBe(false)
})

test('FLUXO TUI: n cancela e o card fica', async () => {
  card('027')
  const { saida } = await sessao(['/rm 27', 'n'])
  expect(saida).toContain('cancelado')
  expect(existsSync(join(dir, '027-x.md'))).toBe(true)
})

test('FLUXO TUI: /rm de card ausente nao deixa estado preso', async () => {
  const { state } = await sessao(['/rm 99'])
  expect(state.removendo).toBe('')
})

test('FLUXO TUI: erro dentro do onLine aparece na tela', async () => {
  const term = fakeTerminal()
  const app = createApp(term, {
    header: () => 'hii',
    corpo: () => [],
    dica: () => '',
    prompt: () => '› ',
    legenda: () => '',
    rodape: () => [],
    intervalMs: 100000,
    onComplete: () => [],
    onInterrupt: () => true,
    onNav: () => false,
    onEntrar: () => {},
    onAba: () => {},
    podeLimpar: () => '',
    fixo: () => [],
    sugestoes: () => [],
    prefixoComum: () => '',
    onLine: async () => { throw new Error('explodiu de proposito') },
  })
  const rodando = app.run()
  term.tecla('x')
  term.tecla('\r')
  await new Promise(r => setTimeout(r, 10))
  term.tecla('\x03')
  await rodando
  expect(stripAnsi(term.saida.join(''))).toContain('explodiu de proposito')
})

test('REGRESSAO corrida: linhas coladas de uma vez nao perdem o estado', async () => {
  card('027')
  card('028')
  const { saida } = await sessao(['/rm 27 28', 's'])
  expect(saida).not.toContain('SUBMIT')
  expect(existsSync(join(dir, '027-x.md'))).toBe(false)
  expect(existsSync(join(dir, '028-x.md'))).toBe(false)
})

test('REGRESSAO corrida: varios comandos em sequencia rapida mantem o estado', async () => {
  card('027')
  card('028')
  const { saida } = await sessao(['/historico', '/rm 27', 's', '/rm 28', 's'])
  expect(saida).not.toContain('SUBMIT')
  expect(existsSync(join(dir, '027-x.md'))).toBe(false)
  expect(existsSync(join(dir, '028-x.md'))).toBe(false)
})

test('ctrl+l limpa a area quando nada roda', async () => {
  const term = fakeTerminal()
  const app = createApp(term, {
    header: () => 'hii', corpo: () => [], dica: () => '', prompt: () => '› ',
    rodape: () => [], intervalMs: 100000, onComplete: () => [], onInterrupt: () => true,
    onNav: () => false, onEntrar: () => {}, onLine: () => {},
    podeLimpar: () => '',
    fixo: () => [],
    sugestoes: () => [],
    prefixoComum: () => '',
  })
  const rodando = app.run()
  app.log('  linha antiga que deve sumir')
  term.tecla('\x0c')
  await new Promise(r => setTimeout(r, 10))
  const antes = stripAnsi(term.saida.join(''))
  term.saida.length = 0
  term.tecla('x')
  await new Promise(r => setTimeout(r, 10))
  term.tecla('\x03')
  await rodando
  expect(antes).toContain('linha antiga')
  expect(stripAnsi(term.saida.join(''))).not.toContain('linha antiga')
})

test('ctrl+l NAO limpa enquanto uma tarefa executa, e explica', async () => {
  const term = fakeTerminal()
  const app = createApp(term, {
    header: () => 'hii', corpo: () => [], dica: () => '', prompt: () => '› ',
    rodape: () => [], intervalMs: 100000, onComplete: () => [], onInterrupt: () => true,
    onNav: () => false, onEntrar: () => {}, onLine: () => {},
    podeLimpar: () => '#031 em execucao — a area so limpa quando terminar',
    fixo: () => [],
    sugestoes: () => [],
    prefixoComum: () => '',
  })
  const rodando = app.run()
  app.log('  linha antiga que deve ficar')
  term.tecla('\x0c')
  await new Promise(r => setTimeout(r, 10))
  term.tecla('\x03')
  await rodando
  const tela = stripAnsi(term.saida.join(''))
  expect(tela).toContain('linha antiga que deve ficar')
  expect(tela).toContain('#031 em execucao')
})

test('cabecalho fixo nao rola para fora quando o log e longo', async () => {
  const term = fakeTerminal()
  const cabecalho = ['  #022 executing  remova o selo beta', '  prompt   remova o selo']
  const app = createApp(term, {
    header: () => 'hii', corpo: () => [], dica: () => '', prompt: () => '› ',
    rodape: () => [], intervalMs: 100000, onComplete: () => [], onInterrupt: () => true,
    onNav: () => false, onEntrar: () => {}, onLine: () => {}, podeLimpar: () => '',
    fixo: () => cabecalho,
    sugestoes: () => [],
    prefixoComum: () => '',
  })
  const rodando = app.run()
  for (let i = 0; i < 60; i++) app.log(`  linha de log ${i}`)
  await new Promise(r => setTimeout(r, 10))
  const tela = telaVirtual(term.saida)
  term.tecla('\x03')
  await rodando
  expect(tela).toContain('#022 executing')
  expect(tela).toContain('prompt')
  expect(tela).toContain('linha de log 59')
  // Fronteira de palavra, nao sufixo '\n': o casamento por '\n' dependia de a
  // linha nao ser a ultima do buffer, e e a mesma forma fragil que
  // test/mir/tui-layout.test.ts acabou de substituir.
  expect(/\blinha de log 0\b/.test(tela), 'a linha mais antiga nao pode estar na tela').toBe(false)
  const visiveis = [...Array(60).keys()].filter(i => new RegExp(`\\blinha de log ${i}\\b`).test(tela))
  expect(visiveis.length, 'o corpo tem de rolar: nao caberiam 60 linhas').toBeLessThan(60)
  expect(visiveis.length).toBeGreaterThan(0)
  expect(visiveis[visiveis.length - 1]).toBe(59)
})

test('dentro da tarefa, as instrucoes ficam ACIMA da execucao', async () => {
  const term = fakeTerminal()
  const execucao = ['  vitro: editando App.vue', '  vitro: rodando build']
  const app = createApp(term, {
    header: () => 'hii', corpo: () => execucao, dica: () => '', prompt: () => '› ',
    rodape: () => [], intervalMs: 100000, onComplete: () => [], onInterrupt: () => true,
    onLine: () => {}, logPrimeiro: () => true,
  })
  const rodando = app.run()
  app.log('  instrucao 12 anotada em #022')
  await new Promise(r => setTimeout(r, 10))
  const tela = telaVirtual(term.saida)
  term.tecla('\x03')
  await rodando
  // Sem a guarda do -1, faltar 'instrucao 12' fazia `-1 < indice` passar: o
  // invariante de ORDEM ficava verde com a linha AUSENTE.
  const iInstrucao = tela.indexOf('instrucao 12')
  const iAtividade = tela.indexOf('vitro: editando')
  expect(iInstrucao, 'a instrucao nao apareceu na tela').toBeGreaterThan(-1)
  expect(iAtividade, 'a atividade do agente nao apareceu na tela').toBeGreaterThan(-1)
  expect(iInstrucao).toBeLessThan(iAtividade)
})

test('fora da tarefa, o log continua abaixo do board', async () => {
  const term = fakeTerminal()
  const app = createApp(term, {
    header: () => 'hii', corpo: () => ['  board do projeto'], dica: () => '', prompt: () => '› ',
    rodape: () => [], intervalMs: 100000, onComplete: () => [], onInterrupt: () => true,
    onLine: () => {}, logPrimeiro: () => false,
  })
  const rodando = app.run()
  app.log('  card #023 criado')
  await new Promise(r => setTimeout(r, 10))
  const tela = telaVirtual(term.saida)
  term.tecla('\x03')
  await rodando
  // Mesma guarda do -1 do teste irmao: sem ela, o board AUSENTE da tela fazia
  // `-1 < indice` passar.
  const iBoard = tela.indexOf('board do projeto')
  const iLog = tela.indexOf('card #023')
  expect(iBoard, 'o board nao apareceu na tela').toBeGreaterThan(-1)
  expect(iLog, 'a linha de log nao apareceu na tela').toBeGreaterThan(-1)
  expect(iBoard).toBeLessThan(iLog)
})

test('instrucoes antigas saem de cena conforme a execucao cresce', async () => {
  const term = fakeTerminal()
  let execucao: string[] = []
  const app = createApp(term, {
    header: () => 'hii', corpo: () => execucao, dica: () => '', prompt: () => '› ',
    rodape: () => [], intervalMs: 100000, onComplete: () => [], onInterrupt: () => true,
    onLine: () => {}, logPrimeiro: () => true,
  })
  const rodando = app.run()
  app.log('  instrucao 1 anotada')
  await new Promise(r => setTimeout(r, 10))
  const telaComExecucaoPequena = telaVirtual(term.saida)
  execucao = Array.from({ length: 40 }, (_, i) => `  passo ${i}`)
  app.log('  instrucao 2 anotada')
  await new Promise(r => setTimeout(r, 10))
  const tela = telaVirtual(term.saida)
  term.tecla('\x03')
  await rodando
  // `not.toContain` sozinho passava com o log NUNCA renderizado. O que prova o
  // mecanismo e o contraste: com execucao PEQUENA a instrucao aparece; com execucao
  // grande ela cede espaco. Sem o contraste, apagar a renderizacao do log deixava o
  // teste verde.
  expect(tela, 'a instrucao antiga tem de sair de cena').not.toContain('instrucao 1 anotada')
  expect(tela, 'a execucao tem de ocupar o corpo').toContain('passo 39')
  expect(telaComExecucaoPequena, 'com execucao pequena a instrucao APARECE — senao o log nunca renderiza').toContain('instrucao 1 anotada')
})
