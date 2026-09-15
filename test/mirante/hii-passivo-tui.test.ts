import { test, expect, beforeEach, afterEach } from '../apoio/runner.ts'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../../motor/mirante/tui/app.ts'
import type { Terminal } from '../../motor/mirante/tui/screen.ts'
import { handle, newSession } from '../../motor/mirante/sessao.ts'
import { dispatch } from '../../motor/mirante/despacho.ts'
import { dispatchIOFalso } from '../fixtures/dispatch-io-falso.ts'
import { telaVirtual } from '../fixtures/tela-virtual.ts'
import { arquivoDoOrquestrador, configDoOrquestrador, configurarOrquestrador } from '../../motor/oswaldo/orquestracao/config.ts'
import { readCard, allCards } from '../../motor/cordel/store.ts'
import { lerSessaoHii } from '../../motor/euclides/sessoes.ts'
import { objetivoComInstrucoes } from '../../motor/mirante/instruir.ts'
import { complete } from '../../motor/mirante/completar.ts'

let dir = ''
let anterior: NodeJS.ProcessEnv
beforeEach(() => {
  anterior = { ...process.env }
  dir = mkdtempSync(join(tmpdir(), 'hii-tui-passivo-'))
  process.env.HII_CARDS_DIR = dir
  process.env.HII_REPOS_FILE = join(dir, 'repos.json')
  mkdirSync(join(dir, 'alvo'))
  writeFileSync(process.env.HII_REPOS_FILE, JSON.stringify([{ name: 'org/app', path: join(dir, 'alvo'), branch: 'main' }]))
})
afterEach(() => { process.env = anterior; rmSync(dir, { recursive: true, force: true }) })

for (const largura of [48, 100]) test(`teclado e tela virtual ${largura}: /hii tarefa/spec, gateway seguinte e /ask sem executar`, async () => {
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
    configurarOrquestrador('org/app', 2)
    writeFileSync(arquivoDoOrquestrador('org/app'), JSON.stringify({ ...configDoOrquestrador('org/app'), modo: 'passivo' }))
    expect(await digitar('/hii')).toContain('arquivo.spec')
    expect(allCards().length).toBe(0)
    expect(await digitar('/new fluxo')).toContain('session #')
    const sessao = state.seguindo
    expect(await digitar('/hii implemente o endpoint')).toContain('na fila')
    const primeira = state.seguindo
    expect(readCard(primeira)?.fm.motor_modo).toBe('passivo')
    expect(readCard(primeira)?.fm.pipeline).toBe('auto')
    expect(readCard(primeira)?.fm.status).toBe('EXECUTING')
    await digitar('agora ajuste o texto')
    const segunda = state.seguindo
    expect(readCard(segunda)?.fm.motor_modo).toBe('gateway')
    expect(lerSessaoHii(sessao)?.execucoes.map(e => e.id)).toEqual([primeira, segunda])
    expect(await digitar('/ask qual o estado?')).toContain('resposta somente leitura')
    expect(consultas).toBe(1)
    expect(lerSessaoHii(sessao)?.execucoes.length).toBe(2)
    writeFileSync(join(dir, 'alvo', 'meu plano.spec'), '# Pedido\nimplemente validacao\n## Criterios\npreserve a API\n## Instrucoes\nnao perca o final\n')
    expect(await digitar('/hii "meu plano.spec"')).toContain('na fila')
    const terceira = state.seguindo
    expect(readCard(terceira)?.fm.motor_modo).toBe('passivo')
    expect(objetivoComInstrucoes(readCard(terceira)!.body)).toContain('nao perca o final')
    expect(lerSessaoHii(sessao)?.mensagens.at(-1)?.texto).toContain('preserve a API')
    const quantidade = allCards().length
    expect(await digitar('/hii ausente.spec')).toContain('orquestrador:')
    expect(await digitar('/hii off')).toContain('arquivo.spec')
    expect(state.seguindo).toBe(terceira)
    expect(allCards().length).toBe(quantidade)
    expect(lerSessaoHii(sessao)?.execucoes.length).toBe(3)
    expect(complete('/hii ', { cards: ['001'], repos: [] })[0]).toEqual([])
    expect(configDoOrquestrador('org/app').modo).toBe('gateway')
  } finally { app.encerrar(); await rodando }
})
