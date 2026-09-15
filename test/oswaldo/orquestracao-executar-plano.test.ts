import { test, expect, beforeEach, afterEach } from '../apoio/runner.ts'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { submit } from '../../motor/mirante/acoes.ts'
import { readCard } from '../../motor/cordel/store.ts'
import { salvarPlano } from '../../motor/oswaldo/orquestracao/planos.ts'
import { executarPlano } from '../../motor/oswaldo/orquestracao/executar-plano.ts'
import { planoOrquestrado } from '../fixtures/plano-orquestrado.ts'

let dir = ''
let anterior: NodeJS.ProcessEnv
beforeEach(() => {
  anterior = { ...process.env }
  dir = mkdtempSync(join(tmpdir(), 'hii-dag-'))
  process.env.HII_CARDS_DIR = join(dir, '.git', 'estado')
  execFileSync('git', ['init', '-q', dir])
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'base'])
})
afterEach(() => { process.env = anterior; rmSync(dir, { recursive: true, force: true }) })

test('DAG real respeita dependencias, registra falha e retoma sem repetir microtask concluida', async () => {
  const { patchCard } = await import('../../motor/cordel/store.ts')
  const id = submit({ title: 'DAG', repo: 'org/app', motor_modo: 'passivo' })
  patchCard(id, { status: 'EXECUTING' })
  const plano = { ...planoOrquestrado(), id }
  salvarPlano(plano, 0, 'teste')
  const chamadas: string[] = []
  let falhar = true
  const implementar: Parameters<typeof executarPlano>[2] = async card => {
    const tarefa = card.fm.title ?? ''
    chamadas.push(tarefa)
    writeFileSync(join(dir, `${tarefa}.txt`), tarefa)
    return tarefa === 'B' && falhar
      ? { ok: false, cost: '0.1', costMeasured: true, failureClass: 'quota', failureReason: 'limite', provider: 'claude' }
      : { ok: true, cost: '0.1', costMeasured: true, resultText: tarefa }
  }
  expect((await executarPlano(readCard(id)!, dir, implementar, false)).ok).toBe(false)
  expect(chamadas).toEqual(['A', 'B'])
  falhar = false
  const r = await executarPlano(readCard(id)!, dir, implementar, false)
  expect(r.ok).toBe(true)
  expect(chamadas).toEqual(['A', 'B', 'B', 'C', 'D'])
  expect(Number(r.cost)).toBeGreaterThan(0.29)
  expect(Number(r.cost)).toBeLessThan(0.31)
  const cache = await executarPlano(readCard(id)!, dir, implementar, false)
  expect(cache.cost).toBe('0')
  expect(chamadas.length).toBe(5)
})
