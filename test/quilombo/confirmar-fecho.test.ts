// Pedido em uso: "preciso de uma confirmacao para tarefas desse tipo, perguntando se
// resolveu o problema? posso encerrar?".
//
// "Desse tipo" e a tarefa SEM URL: nela o humano nunca viu a coisa funcionando. No
// card 006 o motor abriu o PR sozinho depois de 33min de trabalho sem nunca perguntar
// se o conflito estava resolvido do jeito que ele queria.
//
// A parada acontece ANTES do push/PR, e nao depois, e o motivo e destrutivo: o fecho
// apaga o worktree ao abrir o PR, e `ensureWorktree` recria a branch com
// `worktree add -B ... origin/base`, o que DESCARTA os commits do card. Perguntar
// depois do PR faria o "nao resolveu" jogar fora o trabalho. O fluxo completo
// (parada -> confirmacao -> fecho sem repetir passo) esta em fechar-custo.test.ts.
import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { precisaConfirmarFecho, perguntaDeFecho, CONFIRMADO } from '../../motor/quilombo/cartorio/confirmar-fecho.ts'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-confirma-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(process.env.HICODE_CARDS_DIR, { recursive: true })

afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const { createCard, readCard, patchCard } = await import('../../motor/cordel/store.ts')
const core = await import('../../motor/mirante/acoes.ts')
const fecho = await import('../../motor/euclides/metricas-de-fecho.ts')
const retomar = await import('../../motor/quilombo/cartorio/retomar.ts')

function cardEmConfirmacao(): string {
  return createCard({
    title: 'resolva o conflito do PR',
    status: 'CONFIRM',
    repo: 'org/repo',
    verify: 'sem-url',
    tempo_s: '1992',
    cost_usd: '12.9602',
  }, '## Objetivo\nresolver o conflito\n')
}

test('tarefa SEM url pede confirmacao; tarefa visual nao pede', () => {
  expect(precisaConfirmarFecho({ verify: 'sem-url' })).toBe(true)
  expect(precisaConfirmarFecho({ verify: 'ok' }), 'na visual o humano ja olhou a url').toBe(false)
  expect(precisaConfirmarFecho({})).toBe(false)
})

test('card ja confirmado nao pergunta de novo — senao o fecho nunca sai do lugar', () => {
  expect(precisaConfirmarFecho({ verify: 'sem-url', fecho_confirmado: CONFIRMADO })).toBe(false)
})

test('a pergunta leva a conta na mao: tempo, custo e o que rodou', () => {
  const pergunta = perguntaDeFecho({ tempo_s: '1992', cost_usd: '12.9602' }, ['Testes'])
  expect(pergunta).toContain('resolveu o problema? posso encerrar?')
  expect(pergunta).toContain('motor 33m12s')
  expect(pergunta).toContain('US$12.9602')
  expect(pergunta).toContain('rodou [Testes]')
})

test('pipeline sem passo nenhum diz isso, em vez de mostrar lista vazia', () => {
  expect(perguntaDeFecho({ tempo_s: '60' }, [])).toContain('nenhum passo de polimento')
})

test('COMPORTAMENTO confirmar manda o card fechar sem repetir passo', () => {
  const id = cardEmConfirmacao()
  const r = core.confirmarFecho(id)

  expect(r.ok, r.reason).toBe(true)
  const fm = readCard(id)?.fm
  expect(fm?.status, 'URL_OK e o estado que a fila pega para fechar').toBe('URL_OK')
  expect(fm?.fecho_confirmado).toBe(CONFIRMADO)
  expect(fm?.resume_from, 'sem o sentinela de pos-passos o fecho repetiria rufus e testudo').toBe('__apos_passos__')
})

test('COMPORTAMENTO recusar sem dizer o que falta e recusado — repetir o mesmo trabalho nao ajuda', () => {
  const id = cardEmConfirmacao()
  const r = core.recusarFecho(id, '   ')

  expect(r.ok).toBe(false)
  expect(r.reason).toContain('diga o que ainda falta')
  expect(readCard(id)?.fm.status, 'card fica onde estava').toBe('CONFIRM')
})

test('COMPORTAMENTO recusar sem worktree refaz do zero, e o motivo fica gravado', () => {
  const id = cardEmConfirmacao()
  const r = core.recusarFecho(id, 'o conflito voltou no index.html')

  expect(r.ok, r.reason).toBe(true)
  const fm = readCard(id)?.fm
  expect(fm?.status).toBe('EXECUTING')
  expect(fm?.refazer).toBe('true')
  expect(fm?.correction).toBe('o conflito voltou no index.html')
})

test('so card em CONFIRM aceita as duas acoes — nao da para encerrar o que nao perguntou', () => {
  const id = createCard({ title: 'x', status: 'TESTS_GREEN', repo: 'org/repo' }, '## Objetivo\nx\n')

  expect(core.confirmarFecho(id).ok).toBe(false)
  expect(core.recusarFecho(id, 'falta coisa').ok).toBe(false)
  expect(readCard(id)?.fm.status).toBe('TESTS_GREEN')
})


function passo(label: string) {
  return { id: label.toLowerCase(), label, kind: 'agent', agent: 'rufus', state: 'URL_OK', gate: 'none', enabled: true, instruction: '' }
}

const PASSOS = [passo('Arquitetura'), passo('Testes'), passo('Seguranca')] as never[]

function ondeORetomarComeca(id: string): number {
  const fm = readCard(id)?.fm
  return retomar.resumeStart(PASSOS, PASSOS, fm?.resume_from ?? '', id, 'completo')
}

const WORKTREE = join(BASE, 'wt')
mkdirSync(join(WORKTREE, '.git'), { recursive: true })

function cardEmConfirmacaoComWorktree(): string {
  const id = cardEmConfirmacao()
  patchCard(id, { worktree: WORKTREE })
  return id
}

test('REGRESSAO: recusar o fecho COM worktree (vai para CORRECTING) apaga o sentinela — era o caminho que pulava todos os passos', () => {
  const id = cardEmConfirmacaoComWorktree()
  fecho.pauseForConfirmation(id, { fm: readCard(id)?.fm ?? {}, body: '', file: '' } as never, {} as never, 'parou para confirmar', retomar.RESUME_POST_STEPS)

  const r = core.recusarFecho(id, 'o conflito voltou no index.html')

  expect(r.ok, r.reason).toBe(true)
  expect(readCard(id)?.fm.status, 'com worktree a recusa corrige em vez de refazer do zero').toBe('CORRECTING')
  expect(readCard(id)?.fm.resume_from, 'o sentinela e da parada anterior; a recusa o torna mentira').toBe('')
  expect(ondeORetomarComeca(id), 'depois da correcao os passos tem de RODAR, comecando do primeiro').toBe(0)
})

test('REGRESSAO: recusar o fecho SEM worktree (vai para EXECUTING) tambem apaga o sentinela', () => {
  const id = cardEmConfirmacao()
  fecho.pauseForConfirmation(id, { fm: readCard(id)?.fm ?? {}, body: '', file: '' } as never, {} as never, 'parou para confirmar', retomar.RESUME_POST_STEPS)

  expect(readCard(id)?.fm.resume_from, 'a parada grava o sentinela — e daqui que o defeito partia').toBe(retomar.RESUME_POST_STEPS)
  expect(ondeORetomarComeca(id), 'com o sentinela, o laco de passos comeca DEPOIS do ultimo — zero voltas').toBe(PASSOS.length)

  const r = core.recusarFecho(id, 'o conflito voltou no index.html')

  expect(r.ok, r.reason).toBe(true)
  expect(readCard(id)?.fm.resume_from, 'o sentinela e da parada anterior; a recusa o torna mentira').toBe('')
  expect(ondeORetomarComeca(id), 'depois da correcao os passos tem de RODAR, comecando do primeiro').toBe(0)
})

test('confirmar o fecho PRESERVA o sentinela — quem disse que resolveu nao paga os passos de novo', () => {
  const id = cardEmConfirmacao()
  fecho.pauseForConfirmation(id, { fm: readCard(id)?.fm ?? {}, body: '', file: '' } as never, {} as never, 'parou para confirmar', retomar.RESUME_POST_STEPS)

  expect(core.confirmarFecho(id).ok).toBe(true)
  expect(ondeORetomarComeca(id)).toBe(PASSOS.length)
})
