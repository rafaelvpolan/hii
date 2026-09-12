import { test, expect, afterAll, dormir } from '../apoio/runner.ts'
import { spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TEMPO_COM_GIT_MS } from '../tempo-de-teste.ts'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-harness-em-voo-'))
const CARDS = join(BASE, 'cards')
const WT = join(BASE, 'worktree-do-card')
const FORA = join(BASE, 'fora-do-worktree')
const BIN = join(BASE, 'bin')
process.env.HICODE_CARDS_DIR = CARDS
mkdirSync(join(CARDS, 'runs'), { recursive: true })
mkdirSync(join(WT, '.git'), { recursive: true })
mkdirSync(FORA, { recursive: true })
mkdirSync(BIN, { recursive: true })

const FALSO_CLAUDE = join(BIN, 'claude')
writeFileSync(FALSO_CLAUDE, "#!/bin/bash\ntrap '' TERM\nsleep 60\n")
chmodSync(FALSO_CLAUDE, 0o755)

const vivo = await import('../../motor/tomada/harness-em-voo.ts')
const A = await import('../../motor/mirante/acoes.ts')
const { createCard, readCard } = await import('../../motor/cordel/store.ts')
const { pedirSuiteManual } = await import('../../motor/quilombo/cartorio/passos-manuais.ts')
const { instruir } = await import('../../motor/mirante/instruir.ts')

const filhos: ChildProcess[] = []
afterAll(() => {
  for (const f of filhos) { try { f.kill('SIGKILL') } catch { void 0 } }
  rmSync(BASE, { recursive: true, force: true })
})

function subir(argv: string[], cwd: string): number {
  const [cmd, ...args] = argv
  const filho = spawn(cmd ?? '', args, { cwd, stdio: 'ignore' })
  filhos.push(filho)
  return filho.pid ?? 0
}

function teimoso(cwd: string): number {
  return subir(['bash', '-c', "trap '' TERM; sleep 60"], cwd)
}

function card(status: string, worktree = WT): string {
  return createCard({ status, title: 't', repo: 'org/app', risk: 'low', worktree }, '## Objetivo\nx\n')
}

async function esperarMorte(pid: number, tetoMs: number): Promise<boolean> {
  const limite = Date.now() + tetoMs
  while (Date.now() < limite) {
    if (!vivo.pidVivo(pid)) return true
    await dormir(50)
  }
  return !vivo.pidVivo(pid)
}

function registro(id: string, pid: number): string {
  return join(CARDS, 'runs', `${id}.${pid}.harness.pid`)
}

async function morreu(pid: number): Promise<boolean> {
  const ok = await esperarMorte(pid, vivo.ESPERA_SIGTERM_MS + 2000)
  await dormir(200)
  return ok
}

test('registrarHarness grava pid, papel e iniciadoEm ISO; esquecer so apaga se o pid bate', () => {
  const id = card('EXECUTING')
  vivo.registrarHarness(id, 4242, 'implement')
  const lido = JSON.parse(readFileSync(registro(id, 4242), 'utf8')) as { pid: number; papel: string; iniciadoEm: string }
  expect(lido.pid).toBe(4242)
  expect(lido.papel).toBe('implement')
  expect(Number.isNaN(Date.parse(lido.iniciadoEm))).toBe(false)
  vivo.esquecerHarness(id, 9999)
  expect(existsSync(registro(id, 4242)), 'pid diferente nao pode apagar o registro de outro').toBe(true)
  vivo.esquecerHarness(id, 4242)
  expect(existsSync(registro(id, 4242))).toBe(false)
})

test('REGRESSAO halt deixa morto o harness que ignora SIGTERM e registra SIGKILL no diario', async () => {
  const id = card('EXECUTING')
  await dormir(100)
  const pid = teimoso(WT)
  await dormir(150)
  expect(vivo.pidVivo(pid)).toBe(true)
  vivo.registrarHarness(id, pid, 'implement')

  const r = A.halt(id, 'chega')
  expect(r?.status).toBe('HALTED')
  expect(await morreu(pid), 'o harness tinha de estar morto depois do halt').toBe(true)
  const corpo = readCard(id)?.body ?? ''
  expect(corpo).toContain(`harness pid ${pid} encerrado (SIGKILL)`)
  expect(existsSync(registro(id, pid)), 'registro do harness morto tem de sumir').toBe(false)
}, TEMPO_COM_GIT_MS)

test('halt encerra com SIGTERM o harness que obedece, sem escalar', async () => {
  const id = card('EXECUTING')
  const pid = subir(['sleep', '60'], WT)
  await dormir(150)
  vivo.registrarHarness(id, pid, 'implement')
  A.halt(id, 'chega')
  expect(await morreu(pid)).toBe(true)
  expect(readCard(id)?.body ?? '').toContain(`harness pid ${pid} encerrado (SIGTERM)`)
}, TEMPO_COM_GIT_MS)

test('pid registrado que nao e harness nem roda no worktree (reciclado) NAO e morto', async () => {
  const id = card('EXECUTING')
  const pid = subir(['sleep', '60'], FORA)
  await dormir(150)
  vivo.registrarHarness(id, pid, 'implement')
  A.halt(id, 'chega')
  await dormir(300)
  expect(vivo.pidVivo(pid), 'processo estranho tem de continuar vivo').toBe(true)
  expect(readCard(id)?.body ?? '').toContain(`harness pid ${pid}`)
  expect(readCard(id)?.body ?? '').toContain('nao foi morto')
  expect(existsSync(registro(id, pid)), 'registro invalido e descartado').toBe(false)
}, TEMPO_COM_GIT_MS)

test('cmdline de harness prova identidade mesmo fora do worktree', async () => {
  const id = card('EXECUTING', '')
  const pid = subir([FALSO_CLAUDE], FORA)
  await dormir(150)
  vivo.registrarHarness(id, pid, 'implement')
  A.halt(id, 'chega')
  expect(await morreu(pid)).toBe(true)
  expect(readCard(id)?.body ?? '').toContain(`harness pid ${pid} encerrado (SIGKILL)`)
}, TEMPO_COM_GIT_MS)

test('halt sem registro de harness so grava o status', () => {
  const id = card('EXECUTING')
  expect(A.halt(id, 'chega')?.status).toBe('HALTED')
  expect(readCard(id)?.body ?? '').not.toContain('harness pid')
})

test('varredura no arranque: pid morto limpa o arquivo; vivo em card HALTED e encerrado; vivo em card ativo fica', async () => {
  const morto = card('EXECUTING')
  const pidMorto = subir(['true'], WT)
  await dormir(300)
  vivo.registrarHarness(morto, pidMorto, 'implement')

  const parado = card('HALTED')
  const pidParado = teimoso(WT)
  vivo.registrarHarness(parado, pidParado, 'implement')

  const ativo = card('EXECUTING')
  const pidAtivo = subir(['sleep', '60'], WT)
  vivo.registrarHarness(ativo, pidAtivo, 'implement')
  await dormir(150)

  const v = await vivo.varrerHarnessesOrfaos()
  expect(v.mortosLimpos).toContain(morto)
  expect(existsSync(registro(morto, pidMorto))).toBe(false)
  expect(v.encerrados.map(e => e.id)).toContain(parado)
  expect(await morreu(pidParado)).toBe(true)
  expect(readCard(parado)?.body ?? '').toContain(`harness pid ${pidParado} encerrado (SIGKILL)`)
  expect(v.deixados).toContain(ativo)
  expect(vivo.pidVivo(pidAtivo), 'card ativo nao perde o harness na varredura').toBe(true)
  expect(existsSync(registro(ativo, pidAtivo))).toBe(true)
}, TEMPO_COM_GIT_MS)

test('encerramento do motor mata todo harness registrado e deixa linha no diario', async () => {
  for (const f of filhos) { try { f.kill('SIGKILL') } catch { void 0 } }
  rmSync(join(CARDS, 'runs'), { recursive: true, force: true })
  mkdirSync(join(CARDS, 'runs'), { recursive: true })
  const a = card('EXECUTING')
  const pidA = teimoso(WT)
  const b = card('CORRECTING')
  const pidB = subir(['sleep', '60'], WT)
  await dormir(150)
  vivo.registrarHarness(a, pidA, 'implement')
  vivo.registrarHarness(b, pidB, 'step')

  const r = await vivo.encerrarHarnessesRegistrados('encerramento do motor')
  expect(r.length).toBe(2)
  expect(await morreu(pidA)).toBe(true)
  expect(await morreu(pidB)).toBe(true)
  expect(readCard(a)?.body ?? '').toContain(`harness pid ${pidA} encerrado (SIGKILL)`)
  expect(readCard(b)?.body ?? '').toContain(`harness pid ${pidB} encerrado (SIGTERM)`)
  expect(existsSync(registro(a, pidA))).toBe(false)
  expect(existsSync(registro(b, pidB))).toBe(false)
}, TEMPO_COM_GIT_MS)

test('REGRESSAO pid reciclado: registro com starttime de OUTRO processo nao e morto, mesmo o pid sendo hoje um binario de harness', async () => {
  const id = card('EXECUTING')
  const pid = subir([FALSO_CLAUDE], WT)
  await dormir(150)
  vivo.registrarHarness(id, pid, 'implement')
  const caminho = registro(id, pid)
  const lido = JSON.parse(readFileSync(caminho, 'utf8')) as { inicioNoKernel: string }
  expect(lido.inicioNoKernel.length, 'o registro tem de carregar o starttime do kernel').toBeGreaterThan(0)
  writeFileSync(caminho, JSON.stringify({ ...lido, pid, inicioNoKernel: '1' }))
  const r = await vivo.encerrarHarnessDoCard(id, 'teste')
  expect(r.map(x => x.acao)).toEqual(['recusado'])
  expect(vivo.pidVivo(pid), 'processo com outro starttime e outro processo — fica vivo').toBe(true)
  expect(existsSync(caminho)).toBe(false)
  expect(readCard(id)?.body ?? '').toContain('pid reciclado?')
}, TEMPO_COM_GIT_MS)

test('REGRESSAO ideacao: quatro harnesses registrados no MESMO card convivem, esquecer um nao apaga os outros, e o halt encerra todos', async () => {
  const id = card('EXECUTING')
  const pids = [subir(['sleep', '60'], WT), subir(['sleep', '60'], WT), subir(['sleep', '60'], WT), subir(['sleep', '60'], WT)]
  await dormir(150)
  for (const p of pids) vivo.registrarHarness(id, p, 'implement')
  expect(vivo.harnessesDoCard(id).map(h => h.pid).sort()).toEqual([...pids].sort())
  vivo.esquecerHarness(id, pids[0] ?? 0)
  expect(vivo.harnessesDoCard(id).length, 'esquecer um harness nao pode apagar o registro dos outros tres').toBe(3)
  A.halt(id, 'chega')
  for (const p of pids.slice(1)) expect(await morreu(p), `harness ${p} tinha de morrer no halt`).toBe(true)
  expect(vivo.harnessesDoCard(id)).toEqual([])
}, TEMPO_COM_GIT_MS)

test('registro no formato antigo (um slot por card) e migrado e continua encerravel', async () => {
  const id = card('HALTED')
  const pid = subir(['sleep', '60'], WT)
  await dormir(150)
  writeFileSync(join(CARDS, 'runs', `${id}.harness.pid`), JSON.stringify({ pid, papel: 'implement', iniciadoEm: '2026-09-12T00:00:00Z' }))
  const v = await vivo.varrerHarnessesOrfaos()
  expect(v.encerrados.map(e => e.id)).toContain(id)
  expect(await morreu(pid)).toBe(true)
  expect(existsSync(join(CARDS, 'runs', `${id}.harness.pid`))).toBe(false)
  expect(existsSync(registro(id, pid))).toBe(false)
}, TEMPO_COM_GIT_MS)

test('REGRESSAO janela pos-halt: enquanto o harness do card HALTED respira, retomar/passo manual/instrucao sao recusados com motivo; depois que morre, passam', async () => {
  const id = createCard({ status: 'HALTED', title: 't', repo: 'org/app', risk: 'low', worktree: WT, pipeline_pausa: 'manual' }, '## Objetivo\nx\n')
  const pid = teimoso(WT)
  await dormir(150)
  vivo.registrarHarness(id, pid, 'implement')

  expect(vivo.motivoParaEsperarHarness(id)).toContain(`pid ${pid}`)
  expect(A.transition(id, 'EXECUTING', 'retomado pelo humano'), 'retomar com harness vivo tem de ser recusado').toBeNull()
  expect(A.resumeFrom(id, 'Testes')).toBeNull()
  expect(readCard(id)?.fm.status).toBe('HALTED')
  expect(readCard(id)?.body ?? '').toContain('retomada recusada')
  const passo = pedirSuiteManual(id)
  expect(passo.ok).toBe(false)
  expect(passo.mensagem).toContain('ainda esta encerrando')
  const inst = instruir(id, 'mexe no menu')
  expect(inst.ok).toBe(false)
  expect(inst.reason).toContain('ainda esta encerrando')

  process.kill(pid, 'SIGKILL')
  expect(await esperarMorte(pid, 2000)).toBe(true)
  expect(vivo.motivoParaEsperarHarness(id)).toBe('')
  expect(A.transition(id, 'EXECUTING', 'retomado pelo humano')?.status).toBe('EXECUTING')
}, TEMPO_COM_GIT_MS)
