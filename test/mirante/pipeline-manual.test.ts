import { test, expect } from '../apoio/runner.ts'
import { handle, newSession, seguir } from '../../motor/mirante/sessao.ts'

// Mirante — os comandos do pipeline manual na TUI. Quem executa de verdade e o
// runner (cartorio/passos-manuais.ts + handleFinish); aqui se trava a
// DIGITACAO: o que cada forma vira, de onde vem o id, e o erro de uso.

test('cada passo vira pipeline-step, com o id do argumento ou da tarefa aberta', () => {
  const seguindo = seguir(newSession(), '7')
  for (const cmd of ['/arquitetura', '/polimento', '/testes', '/seguranca', '/limpeza']) {
    const r = handle(cmd, seguindo)
    expect(r.effect.kind, cmd).toBe('pipeline-step')
    expect(r.effect.id, cmd).toBe('7')
  }
  const explicito = handle('/polimento 12', newSession())
  expect(explicito.effect).toMatchObject({ kind: 'pipeline-step', id: '12', text: 'polimento' })
})

test('a forma /hii:code:X da referencia resolve para o mesmo passo', () => {
  expect(handle('/hii:code:seguranca 9', newSession()).effect).toMatchObject({ kind: 'pipeline-step', id: '9', text: 'seguranca' })
  expect(handle('/hii:code:polimento 9', newSession()).effect).toMatchObject({ kind: 'pipeline-step', id: '9', text: 'polimento' })
})

test('/hii dispara a suite — id do argumento ou da tarefa aberta', () => {
  expect(handle('/hii', seguir(newSession(), '7')).effect).toMatchObject({ kind: 'pipeline-suite', id: '7' })
  expect(handle('/hii 21', newSession()).effect).toMatchObject({ kind: 'pipeline-suite', id: '21' })
})

test('passo ou suite sem id e sem tarefa aberta explicam o uso, em vez de falhar mudo', () => {
  const passo = handle('/testes', newSession())
  expect(passo.effect.kind).toBe('error')
  expect(passo.effect.text).toContain('/testes')
  const suite = handle('/hii', newSession())
  expect(suite.effect.kind).toBe('error')
  expect(suite.effect.text).toContain('/hii')
})
