import { test, expect, beforeEach } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handle, newSession } from '../../motor/mirante/sessao.ts'
import type { SessionState } from '../../motor/mirante/sessao.ts'
import { dispatchIOFalso } from '../fixtures/dispatch-io-falso.ts'

let dir = ''
let saida: string[] = []

const io = dispatchIOFalso({
  log: (l: string) => { saida.push(l) },
  plano: async (id: string) => [`plano do #${id}`],
  responder: async (pergunta: string) => [`resposta para: ${pergunta}`],
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hicode-disp-aprov-'))
  mkdirSync(join(dir, 'runs'), { recursive: true })
  process.env.HII_CARDS_DIR = dir
  saida = []
})

function card(id: string, fields: Record<string, string> = {}): void {
  const fm = Object.entries({ id, status: 'READY', title: `tarefa ${id}`, repo: 'org/app', ...fields })
    .map(([k, v]) => `${k}: ${v}`).join('\n')
  writeFileSync(join(dir, `${id}-x.md`), `---\n${fm}\n---\n## Objetivo\nx\n`)
}

async function digitar(linhas: string[], inicial?: SessionState): Promise<SessionState> {
  const { dispatch } = await import('../../motor/mirante/despacho.ts')
  let state = inicial ?? newSession('org/app')
  for (const linha of linhas) {
    const r = handle(linha, state)
    state = (await dispatch(r.effect, r.state, io)).state
  }
  return state
}

test('FLUXO: aprovar pelo numero 1 aprova o url', async () => {
  const { aprovando, seguir } = await import('../../motor/mirante/sessao.ts')
  const { readCard } = await import('../../motor/cordel/store.ts')
  card('022', { status: 'URL' })
  const inicial = aprovando(seguir(newSession('org/app'), '022'), '022')
  const state = await digitar(['1'], inicial)
  expect(readCard('022')?.fm.status).toBe('URL_OK')
  expect(state.aprovando).toBe('')
})

test('FLUXO: recusar pelo 2 manda refazer', async () => {
  const { aprovando, seguir } = await import('../../motor/mirante/sessao.ts')
  const { readCard } = await import('../../motor/cordel/store.ts')
  card('022', { status: 'URL' })
  await digitar(['2'], aprovando(seguir(newSession('org/app'), '022'), '022'))
  expect(readCard('022')?.fm.status).not.toBe('URL_OK')
})

test('FLUXO: recusar pelo 3 pede o comentario, e o texto vira o motivo', async () => {
  const { aprovando, seguir } = await import('../../motor/mirante/sessao.ts')
  const { readCard } = await import('../../motor/cordel/store.ts')
  card('022', { status: 'URL', worktree: dir })
  let state = aprovando(seguir(newSession('org/app'), '022'), '022')
  state = await digitar(['3'], state)
  expect(state.comentando).toBe('022')
  expect(saida.join(' ')).toContain('escreva o que precisa ajustar')
  state = await digitar(['o selo ficou desalinhado'], state)
  expect(state.comentando).toBe('')
  const c = readCard('022')
  const guardou = String(c?.fm.correction ?? '') + (c?.body ?? '')
  expect(guardou).toContain('desalinhado')
})

test('FLUXO: enter vazio desiste do comentario sem recusar', async () => {
  const { comentando, seguir } = await import('../../motor/mirante/sessao.ts')
  const { readCard } = await import('../../motor/cordel/store.ts')
  card('022', { status: 'URL' })
  const state = await digitar([''], comentando(seguir(newSession('org/app'), '022'), '022'))
  expect(state.comentando).toBe('')
  expect(readCard('022')?.fm.status).toBe('URL')
})

test('FLUXO: enter dentro da tarefa faz a acao obvia de cada estado', async () => {
  const { seguir } = await import('../../motor/mirante/sessao.ts')
  const { readCard } = await import('../../motor/cordel/store.ts')
  card('030', { status: 'URL' })
  await digitar([''], seguir(newSession('org/app'), '030'))
  expect(readCard('030')?.fm.status).toBe('URL_OK')

  card('031', { status: 'HALTED' })
  await digitar([''], seguir(newSession('org/app'), '031'))
  expect(readCard('031')?.fm.status).toBe('EXECUTING')

  card('032', { status: 'READY' })
  await digitar([''], seguir(newSession('org/app'), '032'))
  expect(readCard('032')?.fm.status).not.toBe('READY')
})

test('FLUXO: enter em tarefa rodando nao mexe em nada', async () => {
  const { seguir } = await import('../../motor/mirante/sessao.ts')
  const { readCard } = await import('../../motor/cordel/store.ts')
  card('022', { status: 'EXECUTING' })
  await digitar([''], seguir(newSession('org/app'), '022'))
  expect(readCard('022')?.fm.status).toBe('EXECUTING')
  expect(saida.join(' ')).toContain('nada para aprovar agora')
})

test('COMPATIBILIDADE: card velho com url/url_pid continua legivel e nao perde os campos', async () => {
  const { readCard } = await import('../../motor/cordel/store.ts')
  const { renderCabecalhoTarefa } = await import('../../motor/mirante/render/tarefa.ts')
  const { seguir } = await import('../../motor/mirante/sessao.ts')
  card('040', { status: 'EXECUTED', worktree: dir, url: 'http://localhost:5240', url_pid: '4242' })
  await digitar(['tira tambem o selo'], seguir(newSession('org/app'), '040'))
  const c = readCard('040')
  expect(c?.fm.url).toBe('http://localhost:5240')
  expect(c?.fm.url_pid).toBe('4242')
  if (!c) throw new Error('card velho deixou de ser legivel')
  expect(renderCabecalhoTarefa(c, { width: 78 }).join('\n')).toContain('http://localhost:5240')
})

test('FLUXO REAL: a dica do rodape para card em URL leva mesmo a aprovacao', async () => {
  const { esperandoVoce } = await import('../../motor/mirante/render/rodape.ts')
  const { allCards, readCard } = await import('../../motor/cordel/store.ts')
  card('033', { status: 'URL' })
  const dica = esperandoVoce(allCards(), 'org/app')[0]?.comando ?? ''
  expect(dica).toBe('33')
  const armado = await digitar([dica])
  expect(armado.seguindo).toBe('033')
  expect(armado.aprovando).toBe('033')
  await digitar(['1'], armado)
  expect(readCard('033')?.fm.status).toBe('URL_OK')
})

test('FLUXO REAL: aprovar o plano com o daemon offline avisa em vez de fingir que ja roda', async () => {
  const { dispatch } = await import('../../motor/mirante/despacho.ts')
  card('038', { status: 'READY' })
  const foraDoAr: string[] = []
  const ioOffline = dispatchIOFalso({
    log: (l: string) => { foraDoAr.push(l) },
    daemonOnline: () => false,
  })
  const inicial = newSession('org/app')
  const r = handle('38', inicial)
  const armado = (await dispatch(r.effect, r.state, ioOffline)).state
  await dispatch({ kind: 'approve-plan', id: '38' }, armado, ioOffline)
  const texto = foraDoAr.join(' ')
  expect(texto).toContain('daemon offline')
  expect(texto).toContain('hii start')
})

test('FLUXO REAL: numero de card que nao esta em URL continua abrindo o plano', async () => {
  card('034', { status: 'READY' })
  const state = await digitar(['34'])
  expect(state.pendingPlan).toBe('34')
  expect(state.aprovando).toBe('')
  expect(saida.join(' ')).toContain('plano do #34')
})

test('FLUXO REAL: /new cria uma session persistida no projeto e passa a segui-la', async () => {
  const { allCards, readCard } = await import('../../motor/cordel/store.ts')
  const antes = allCards().length
  const depois = await digitar(['/new conversa sobre roteador'])
  expect(allCards().length).toBe(antes + 1)
  expect(depois.seguindo).toBeTruthy()
  expect(depois.repo).toBe('org/app')
  const criada = readCard(depois.seguindo)
  expect(criada?.fm.tipo).toBe('session')
  expect(criada?.fm.repo).toBe('org/app')
  expect(criada?.body).toContain('conversa sobre roteador')
  expect(saida.join(' ')).toContain('session #')
})

test('FLUXO REAL: texto dentro da session aparece na TUI como pergunta sem execucao', async () => {
  const { readCard } = await import('../../motor/cordel/store.ts')
  let state = await digitar(['/new diagnostico do roteador'])
  const id = state.seguindo
  saida = []

  state = await digitar(['por que nao trocou de IA?'], state)

  const textoDaTela = saida.join('\n')
  expect(state.seguindo).toBe(id)
  expect(textoDaTela).toContain(`session #${id}: pergunta de leitura, sem executar tarefa`)
  expect(textoDaTela).toContain('resposta para: por que nao trocou de IA?')
  const session = readCard(id)
  expect(session?.fm.status).toBe('READY')
  expect(session?.body).toContain('pergunta na session: por que nao trocou de IA?')
})

test('FLUXO REAL: pergunta dentro da session encaminha o ID para o ledger da IA', async () => {
  const { dispatch } = await import('../../motor/mirante/despacho.ts')
  const { submitSession } = await import('../../motor/mirante/acoes.ts')
  let sessionId = ''
  const ioDaSession = dispatchIOFalso({
    log: () => undefined,
    responder: async (_pergunta: string, _conversa: { pergunta: string; resposta: string }[], id?: string) => {
      sessionId = id ?? ''
      return ['resposta']
    },
  })
  const id = submitSession({ title: 'session ledger', repo: 'org/app', desc: 'perguntas' })
  await dispatch({ kind: 'instruct', id, text: 'qual o estado?' }, { ...newSession('org/app'), seguindo: id }, ioDaSession)
  expect(sessionId).toBe(id)
})

test('FLUXO REAL: trocar de projeto fecha a ask de aprovacao do projeto anterior', async () => {
  const { aprovando, seguir } = await import('../../motor/mirante/sessao.ts')
  card('036', { status: 'URL' })
  card('037', { repo: 'outra/app' })
  const armado = aprovando(seguir(newSession('org/app'), '036'), '036')
  const trocado = await digitar(['/repo outra/app'], armado)
  expect(trocado.aprovando).toBe('')
  expect(trocado.seguindo).toBe('')
})
