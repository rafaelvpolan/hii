import { test, expect, beforeEach, afterEach } from '../apoio/runner.ts'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
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

test('atribuicao por microtask chega ao executor e tentativas preservam autoria', async () => {
  const { patchCard } = await import('../../motor/cordel/store.ts')
  const id = submit({ title: 'IAs', repo: 'org/app', motor_modo: 'passivo' })
  patchCard(id, { status: 'EXECUTING', provider_override_implement: 'kimi' })
  const plano = { ...planoOrquestrado(), id, sessaoId: id }
  plano.microtasks[0]!.ia = { provedor: 'claude', modelo: 'modelo-a' }
  plano.microtasks[1]!.ia = { provedor: 'codex', modelo: 'modelo-b' }
  const revisao = salvarPlano(plano, 0, 'ias')
  const chamadas: string[] = []
  await executarPlano(readCard(id)!, dir, async card => {
    chamadas.push(`${card.fm.provider_override_implement}:${card.fm.orq_modelo || ''}`)
    return { ok: true, cost: '0', costMeasured: true, provider: card.fm.provider_override_implement, model: card.fm.orq_modelo }
  }, false)
  expect(chamadas).toEqual(['claude:modelo-a', 'codex:modelo-b', 'kimi:', 'kimi:'])
  const cache = JSON.parse(readFileSync(join(process.env.HII_CARDS_DIR!, 'orquestracao', `execucao-${id}-${revisao.revisao}.json`), 'utf8')) as { tentativas: { provedor: string; estado: string }[] }
  expect(cache.tentativas.map(t => t.provedor)).toEqual(['claude', 'codex', 'kimi', 'kimi'])
  expect(cache.tentativas.every(t => t.estado === 'concluida')).toBe(true)
})

test('provedor desconhecido ou sem edicao recusa o plano antes de executar qualquer tarefa', async () => {
  const { patchCard } = await import('../../motor/cordel/store.ts')
  for (const provedor of ['inexistente', 'ollama']) {
    const id = submit({ title: 'Invalido', repo: 'org/app', motor_modo: 'passivo' })
    patchCard(id, { status: 'EXECUTING' })
    const plano = { ...planoOrquestrado(), id, sessaoId: id }
    plano.microtasks[3]!.ia = { provedor }
    salvarPlano(plano, 0, 'invalido')
    let chamadas = 0
    await expect(executarPlano(readCard(id)!, dir, async () => {
      chamadas++
      return { ok: true, cost: '0' }
    }, false)).rejects.toThrow()
    expect(chamadas).toBe(0)
  }
})

test('cota da IA atribuida exige intervencao sem trocar silenciosamente o plano', async () => {
  const { patchCard } = await import('../../motor/cordel/store.ts')
  const id = submit({ title: 'Cota', repo: 'org/app', motor_modo: 'passivo' })
  patchCard(id, { status: 'EXECUTING' })
  const plano = { ...planoOrquestrado(), id, sessaoId: id }
  plano.microtasks[0]!.ia = { provedor: 'claude' }
  salvarPlano(plano, 0, 'cota')
  const resultado = await executarPlano(readCard(id)!, dir, async () => ({
    ok: false, cost: '0', provider: 'claude', failureClass: 'quota', failureReason: 'limite',
  }), false)
  expect(resultado.failureClass).toBe('terminal')
  expect(resultado.failureReason).toContain('IA atribuida a A')
})

test('excecao depois de efeito preserva trabalho e bloqueia repeticao cega na retomada', async () => {
  const { patchCard } = await import('../../motor/cordel/store.ts')
  const id = submit({ title: 'Interrompida', repo: 'org/app', motor_modo: 'passivo' })
  patchCard(id, { status: 'EXECUTING' })
  salvarPlano({ ...planoOrquestrado(), id, sessaoId: id }, 0, 'incerta')
  let chamadas = 0
  const implementar: Parameters<typeof executarPlano>[2] = async () => {
    chamadas++
    writeFileSync(join(dir, 'efeito.txt'), 'efeito confirmado no disco')
    throw new Error('resposta perdida')
  }
  await expect(executarPlano(readCard(id)!, dir, implementar, false)).rejects.toThrow('resposta perdida')
  const retomada = await executarPlano(readCard(id)!, dir, implementar, false)
  expect(retomada.ok).toBe(false)
  expect(retomada.failureReason).toContain('reconciliacao')
  expect(retomada.costMeasured).toBe(false)
  expect(chamadas).toBe(1)
  expect(readFileSync(join(dir, 'efeito.txt'), 'utf8')).toBe('efeito confirmado no disco')
})

test('base sem merge predecessor nao chama IA; integrar o commit libera o plano', async () => {
  const { patchCard } = await import('../../motor/cordel/store.ts')
  const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
  writeFileSync(join(dir, 'predecessora.txt'), 'entrega')
  execFileSync('git', ['add', '.'], { cwd: dir })
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'predecessora'], { cwd: dir })
  const merge = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
  execFileSync('git', ['checkout', '--detach', base], { cwd: dir, stdio: 'ignore' })
  const id = submit({ title: 'Dependente', repo: 'org/app', motor_modo: 'passivo' })
  patchCard(id, { status: 'EXECUTING' })
  const plano = { ...planoOrquestrado(), id, sessaoId: id, produtoId: 'sucessora',
    dependenciasProduto: [{ produto: 'anterior', execucao: '099', tecnicoHash: 'a'.repeat(64), certificado: 'b'.repeat(64), merge }] }
  salvarPlano(plano, 0, 'dependencia')
  let chamadas = 0
  const implementar: Parameters<typeof executarPlano>[2] = async () => { chamadas++; return { ok: true, cost: '0', costMeasured: true } }
  const bloqueado = await executarPlano(readCard(id)!, dir, implementar, false)
  expect(bloqueado.ok).toBe(false)
  expect(chamadas).toBe(0)
  expect(bloqueado.reason).toContain('anterior')
  execFileSync('git', ['merge', '--ff-only', merge], { cwd: dir, stdio: 'ignore' })
  expect((await executarPlano(readCard(id)!, dir, implementar, false)).ok).toBe(true)
  expect(chamadas).toBe(4)
})

test('parada na ultima microtask conserva resultado e custo sem anunciar sucesso do plano', async () => {
  const { patchCard, updateCardPorAcaoHumana } = await import('../../motor/cordel/store.ts')
  const id = submit({ title: 'Parada final', repo: 'org/app', motor_modo: 'passivo' })
  patchCard(id, { status: 'EXECUTING' })
  const plano = { ...planoOrquestrado(), id, sessaoId: id }
  plano.microtasks = plano.microtasks.slice(0, 1)
  salvarPlano(plano, 0, 'parada-final')
  let chamadas = 0
  const implementar: Parameters<typeof executarPlano>[2] = async () => {
    chamadas++
    writeFileSync(join(dir, 'feito.txt'), 'efeito confirmado')
    patchCard(id, { status: 'HALTED', halt_class: 'humano', halt_reason: 'parar agora' })
    return { ok: true, cost: '0.25', costMeasured: true }
  }
  const r = await executarPlano(readCard(id)!, dir, implementar, false)
  expect(r.ok).toBe(false)
  expect(r.cost).toBe('0.25')
  expect(r.costMeasured).toBe(true)
  expect((await executarPlano(readCard(id)!, dir, implementar, false)).ok).toBe(false)
  expect(chamadas).toBe(1)
  updateCardPorAcaoHumana(id, { fields: { status: 'EXECUTING' } })
  const retomada = await executarPlano(readCard(id)!, dir, implementar, false)
  expect(retomada.ok).toBe(true)
  expect(retomada.cost).toBe('0')
  expect(chamadas).toBe(1)
  expect(readFileSync(join(dir, 'feito.txt'), 'utf8')).toBe('efeito confirmado')
})

test('sucesso declarado pelo agente nao libera sucessoras quando o teste real falha', async () => {
  const { patchCard } = await import('../../motor/cordel/store.ts')
  const id = submit({ title: 'Falso sucesso', repo: 'org/app', motor_modo: 'passivo' })
  patchCard(id, { status: 'EXECUTING' })
  const plano = { ...planoOrquestrado(), id, sessaoId: id }
  plano.criterios[0]!.comando = { binario: 'node', argumentos: ['-e', 'process.exit(7)'], diretorio: '.', timeoutMs: 3000 }
  salvarPlano(plano, 0, 'falso-sucesso')
  const chamadas: string[] = []
  const resultado = await executarPlano(readCard(id)!, dir, async card => {
    chamadas.push(card.fm.title || '')
    return { ok: true, cost: '0.15', costMeasured: true, resultText: 'Tudo passou; pode continuar.' }
  }, false)
  expect(resultado.ok).toBe(false)
  expect(resultado.reason).toContain('criterios')
  expect(chamadas).toEqual(['A'])
  expect(resultado.cost).toBe('0.15')
})

test('criterio obrigatorio sem comando nao e aprovado pelo texto do agente', async () => {
  const { patchCard } = await import('../../motor/cordel/store.ts')
  const id = submit({ title: 'Inconclusivo', repo: 'org/app', motor_modo: 'passivo' })
  patchCard(id, { status: 'EXECUTING' })
  const plano = { ...planoOrquestrado(), id, sessaoId: id }
  delete plano.criterios[0]!.comando
  salvarPlano(plano, 0, 'inconclusivo')
  let chamadas = 0
  const r = await executarPlano(readCard(id)!, dir, async () => {
    chamadas++
    return { ok: true, cost: '0', costMeasured: true }
  }, false)
  expect(r.ok).toBe(false)
  expect(chamadas).toBe(1)
})

test('alteracao externa invalida checkpoint sem repetir efeitos ja executados', async () => {
  const { patchCard } = await import('../../motor/cordel/store.ts')
  const id = submit({ title: 'Checkpoint alterado', repo: 'org/app', motor_modo: 'passivo' })
  patchCard(id, { status: 'EXECUTING' })
  salvarPlano({ ...planoOrquestrado(), id, sessaoId: id }, 0, 'checkpoint-alterado')
  let chamadas = 0
  const executar: Parameters<typeof executarPlano>[2] = async () => {
    chamadas++
    return { ok: true, cost: '0.1', costMeasured: true }
  }
  expect((await executarPlano(readCard(id)!, dir, executar, false)).ok).toBe(true)
  writeFileSync(join(dir, 'alteracao-humana.txt'), 'preservar')
  const depois = await executarPlano(readCard(id)!, dir, executar, false)
  expect(depois.ok).toBe(false)
  expect(depois.reason).toContain('mudou')
  expect(chamadas).toBe(4)
  expect(readFileSync(join(dir, 'alteracao-humana.txt'), 'utf8')).toBe('preservar')
})
