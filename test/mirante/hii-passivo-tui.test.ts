import { test, expect, beforeEach, afterEach } from '../apoio/runner.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../../motor/mirante/tui/app.ts'
import type { Terminal } from '../../motor/mirante/tui/screen.ts'
import { handle, newSession } from '../../motor/mirante/sessao.ts'
import { dispatch } from '../../motor/mirante/despacho.ts'
import { dispatchIOFalso } from '../fixtures/dispatch-io-falso.ts'
import { telaVirtual } from '../fixtures/tela-virtual.ts'
import { configDoOrquestrador } from '../../motor/oswaldo/orquestracao/config.ts'
import { readCard, patchCard } from '../../motor/cordel/store.ts'
import { lerSessaoHii } from '../../motor/euclides/sessoes.ts'

let dir = ''
let anterior: NodeJS.ProcessEnv
beforeEach(() => {
  anterior = { ...process.env }
  dir = mkdtempSync(join(tmpdir(), 'hii-tui-passivo-'))
  process.env.HII_CARDS_DIR = dir
})
afterEach(() => { process.env = anterior; rmSync(dir, { recursive: true, force: true }) })

for (const largura of [48, 100]) test(`teclado e tela virtual ${largura}: /hii, /new, pedidos encadeados, /ask, off e close`, async () => {
  const saida: string[] = []
  let tecla = (_k: string): void => {}
  const terminal: Terminal = { write: s => { saida.push(s) }, rows: () => 28, cols: () => largura,
    onResize: () => {}, offResize: () => {}, onKey: f => { tecla = f }, offKey: () => {}, setRaw: () => {} }
  let state = newSession('org/app')
  let concluiu: (() => void) | null = null
  let consultas = 0
  const app = createApp(terminal, { header: () => 'hii', corpo: () => [], dica: () => '', prompt: () => '> ', rodape: () => [],
    onComplete: () => [], onInterrupt: () => true, intervalMs: 100000,
    onLine: async linha => {
      try {
        const r = handle(linha, state)
        state = (await dispatch(r.effect, r.state, dispatchIOFalso({ largura: () => largura,
          log: l => app.log(l), responder: async () => { consultas++; return ['resposta somente leitura'] } }))).state
      } finally { concluiu?.() }
    },
  })
  const rodando = app.run()
  const digitar = async (texto: string): Promise<string> => {
    const terminou = new Promise<void>(r => { concluiu = r })
    for (const c of texto) tecla(c)
    tecla('\r')
    await terminou
    await new Promise(r => setTimeout(r, 20))
    return telaVirtual(saida, largura)
  }
  try {
    expect(configDoOrquestrador('org/app').modo).toBe('gateway')
    expect(await digitar('/hii')).toContain('motor: passivo')
    expect(await digitar('/new fluxo')).toContain('session #')
    const sessao = state.seguindo
    expect(await digitar('implemente o endpoint')).toContain('na fila')
    const primeira = state.seguindo
    expect(readCard(primeira)?.fm.motor_modo).toBe('passivo')
    expect(await digitar('/hii off')).toContain('motor: gateway')
    expect(readCard(primeira)?.fm.motor_modo).toBe('passivo')
    await digitar('agora ajuste o texto')
    const segunda = state.seguindo
    expect(readCard(segunda)?.fm.motor_modo).toBe('gateway')
    expect(lerSessaoHii(sessao)?.execucoes.map(e => e.id)).toEqual([primeira, segunda])
    expect(await digitar('/ask qual o estado?')).toContain('resposta somente leitura')
    expect(consultas).toBe(1)
    expect(lerSessaoHii(sessao)?.execucoes.length).toBe(2)
    patchCard(primeira, { status: 'HALTED', halt_class: 'humano' })
    patchCard(segunda, { status: 'COMPLETED' })
    expect(await digitar(`/hii close ${sessao}`)).toContain(`#${sessao} closed`)
    expect(lerSessaoHii(sessao)?.estado).toBe('fechada')
  } finally { app.encerrar(); await rodando }
})
