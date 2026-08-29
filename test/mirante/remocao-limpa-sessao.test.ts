import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DispatchIO } from '../../motor/mirante/despacho.ts'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-rm-sessao-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(join(process.env.HICODE_CARDS_DIR, 'runs'), { recursive: true })
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const { createCard, readCard, patchCard } = await import('../../motor/cordel/store.ts')
const { dispatch } = await import('../../motor/mirante/despacho.ts')
const { newSession, seguir } = await import('../../motor/mirante/sessao.ts')
const { todosOsCards } = await import('../../motor/mirante/cli/dados.ts')

function io(): DispatchIO {
  return {
    log: () => {}, dim: (t) => t, color: false, largura: () => 80,
    responder: () => Promise.resolve([]), plano: () => Promise.resolve([]),
    daemonOnline: () => true, iaProntaParaEnviar: () => ({ ok: true, motivo: '' }),
  }
}

function cardComPergunta(): string {
  const id = createCard({ title: 'para apagar', status: 'HALTED', repo: 'org/site' }, '## Objetivo\nx\n')
  patchCard(id, { review_questions: JSON.stringify(['pergunta que fica aberta?']) })
  return id
}

// Reportado em uso: "quando removo o card com /rm nao esta sumindo debaixo do prompt
// e as perguntas dele nao estao sumindo quando ja aberta". O dado saia certo — o que
// ficava era a SESSAO apontando para um card que nao existe mais. `confirm-rm` so
// limpava `seguindo`, e so quando o removido era justamente ele.
test('REGRESSAO: apagar o card limpa TODO estado de sessao que apontava para ele', async () => {
  const id = cardComPergunta()
  const estado = {
    ...seguir(newSession('org/site'), id),
    perguntando: id, perguntaVista: `${id}:x`, aprovando: id,
    comentando: id, retomando: id, pendingPlan: id, removendo: id,
  }
  const depois = await dispatch({ kind: 'confirm-rm', id, text: 'sim' }, estado, io())
  expect(readCard(id), 'o card foi mesmo apagado').toBeNull()
  for (const campo of ['seguindo', 'perguntando', 'perguntaVista', 'aprovando', 'comentando', 'retomando', 'pendingPlan', 'removendo'] as const) {
    expect(depois.state[campo], `"${campo}" ficou apontando para card apagado`).toBe('')
  }
})

test('apagar OUTRO card nao derruba a tarefa aberta', async () => {
  const aberta = cardComPergunta()
  const outra = createCard({ title: 'outra', status: 'HALTED', repo: 'org/site' }, '## Objetivo\ny\n')
  const estado = { ...seguir(newSession('org/site'), aberta), perguntando: aberta }
  const depois = await dispatch({ kind: 'confirm-rm', id: outra, text: 'sim' }, estado, io())
  expect(depois.state.seguindo, 'so o card apagado sai da sessao').toBe(aberta)
  expect(depois.state.perguntando).toBe(aberta)
  expect(depois.state.removendo, 'mas a remocao terminou').toBe('')
})

test('cancelar nao apaga nem mexe na sessao', async () => {
  const id = cardComPergunta()
  const estado = { ...seguir(newSession('org/site'), id), perguntando: id }
  const depois = await dispatch({ kind: 'confirm-rm', id, text: 'nao' }, estado, io())
  expect(readCard(id), 'cancelou — o card fica').not.toBeNull()
  expect(depois.state.seguindo).toBe(id)
})

test('o card apagado some da lista debaixo do prompt', async () => {
  const id = cardComPergunta()
  await dispatch({ kind: 'confirm-rm', id, text: 'sim' }, newSession('org/site'), io())
  await new Promise(r => setTimeout(r, 300))
  expect(todosOsCards().some(c => c.id === id), 'o rodape le esta lista').toBe(false)
})

// `removendo` nao limpo deixava `ocupado(state)` verdadeiro para sempre — e
// `sincronizarPergunta` e `sincronizarAprovacao` desistem quando a sessao esta
// ocupada. Uma remocao travava as duas deteccoes ate reiniciar a TUI.
test('REGRESSAO: depois de apagar, a sessao nao fica ocupada para sempre', async () => {
  const id = cardComPergunta()
  const outro = cardComPergunta()
  const estado = { ...seguir(newSession('org/site'), outro), removendo: id }
  const depois = await dispatch({ kind: 'confirm-rm', id, text: 'sim' }, estado, io())
  expect(depois.state.removendo).toBe('')
  const { sincronizarPergunta } = await import('../../motor/mirante/sessao.ts')
  expect(sincronizarPergunta(depois.state, `${outro}:p`).perguntando, 'a deteccao volta a funcionar').toBe(outro)
})
