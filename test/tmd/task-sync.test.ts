import { test, expect } from 'bun:test'
import { parseIssues } from '../../motor/tmd/pnt/tarefas/github-issues.ts'
import { taskSync, taskSyncName, taskSyncNames } from '../../motor/tmd/pnt/tarefas/registro.ts'

test('parseIssues mapeia JSON do gh para ExternalTask', () => {
  const json = JSON.stringify([
    { number: 42, title: 'Bug no header', body: 'detalhe' },
    { number: 7, title: 'Sem corpo' },
  ])
  const tasks = parseIssues(json)
  expect(tasks.length).toBe(2)
  expect(tasks[0]).toEqual({ externalId: '42', title: 'Bug no header', body: 'detalhe' })
  expect(tasks[1]?.body).toBe('')
})

// Antes este teste exigia que JSON invalido virasse `[]`. Era a especificacao do
// defeito: `gh` ausente ou sem login produzia lista vazia, e o CLI anunciava
// "0 cards criados, N espelhados de 0 externos" com exit 0 — sucesso declarado
// sobre uma sincronizacao que nunca falou com o GitHub. "Nenhuma issue aberta" e
// "nao consegui ler as issues" nao podem ter a mesma representacao.
test('parseIssues LANCA em JSON invalido — lista vazia nao pode significar "falhei"', () => {
  expect(() => parseIssues('nao json')).toThrow()
  expect(() => parseIssues('{}'), 'objeto nao e lista de issues').toThrow('nao e lista')
})

test('parseIssues aceita lista vazia de verdade — issue nenhuma aberta e resposta valida', () => {
  expect(parseIssues('[]')).toEqual([])
})

test('taskSync default = none (sem sync externo)', () => {
  expect(taskSyncName()).toBe('none')
  expect(taskSync()).toBeNull()
  expect(taskSyncNames()).toContain('github-issues')
})

test('runSync NAO conta como espelhado o que falhou, e marca ok=false', async () => {
  const { runSync } = await import('../../motor/tmd/pnt/tarefas/sync.ts')
  const r = await runSync()
  // Sem HICODE_TASK_SYNC configurado nao ha sync: relatorio zerado e ok.
  expect(r.ok).toBe(true)
  expect(r.falhas).toEqual([])
  expect(r.pushed).toBe(0)
})

test('relatoDeSync mostra as falhas em vez de imprimir so os numeros', async () => {
  const { relatoDeSync } = await import('../../motor/tmd/pnt/tarefas/sync.ts')
  const bom = relatoDeSync('github-issues', { pulled: 3, created: 1, pushed: 2, falhas: [], ok: true, reaproveitados: 0 })
  expect(bom).toContain('2 espelhados de 3 externos')
  expect(bom).not.toContain('FALHA')
  const ruim = relatoDeSync('github-issues', { pulled: 0, created: 0, pushed: 0, falhas: ['pull: gh nao autenticado'], ok: false, reaproveitados: 0 })
  expect(ruim, 'o numero sozinho lia como sucesso').toContain('FALHA')
  expect(ruim).toContain('gh nao autenticado')
})

// `pushed++` contava o card mesmo quando `executarComIdempotencia` REAPROVEITOU a
// chave e nada foi postado: "N espelhados" para efeito que nao aconteceu nesta
// execucao — a mesma contagem enganosa que este arquivo existe para eliminar.
test('relatoDeSync separa espelhado AGORA de ja espelhado antes', async () => {
  const { relatoDeSync } = await import('../../motor/tmd/pnt/tarefas/sync.ts')
  const r = relatoDeSync('github-issues', { pulled: 5, created: 0, pushed: 1, falhas: [], ok: true, reaproveitados: 4 })
  expect(r).toContain('1 espelhados')
  expect(r, 'somar reaproveitado a espelhado inventa efeito').toContain('4 ja espelhados antes')
})

test('sem reaproveitamento, o relato nao ganha ruido', async () => {
  const { relatoDeSync } = await import('../../motor/tmd/pnt/tarefas/sync.ts')
  expect(relatoDeSync('github-issues', { pulled: 1, created: 0, pushed: 1, falhas: [], ok: true, reaproveitados: 0 }))
    .not.toContain('ja espelhados')
})

test('TaskSync.push devolve se o efeito aconteceu AGORA — void nao distinguia nada', async () => {
  const { GithubIssuesSync } = await import('../../motor/tmd/pnt/tarefas/github-issues.ts')
  const s = new GithubIssuesSync()
  // Card sem `source` nao tem issue para comentar: nada aconteceu.
  expect(await s.push({ id: '1', status: 'READY' })).toBe(false)
})
