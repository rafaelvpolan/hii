import { test, expect, afterEach, beforeEach } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let estado = ''

beforeEach(() => {
  estado = mkdtempSync(join(tmpdir(), 'hii-painel-'))
  mkdirSync(join(estado, 'runs'), { recursive: true })
  process.env.HICODE_CARDS_DIR = estado
  process.env.HICODE_COTA_TTL_MS = '0'
  process.env.HICODE_RUNNER_PIDFILE = join(estado, '.runner.pid')
})

afterEach(() => {
  delete process.env.HICODE_RUNNER_PIDFILE
})

function card(id: string, campos: Record<string, string> = {}): void {
  const fm = { id, status: 'READY', title: `tarefa ${id}`, repo: 'org/app', created: '2026-08-19T12:00:00Z', updated: '2026-08-19T12:30:00Z', ...campos }
  const cabeca = Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join('\n')
  writeFileSync(join(estado, `${id}-slug.md`), `---\n${cabeca}\n---\n## Objetivo\nfazer x\n`)
}

function clarify(id: string): void {
  writeFileSync(join(estado, 'runs', `${id}.clarify.json`), JSON.stringify([
    { q: 'o filtro vem de onde?', options: ['querystring', 'estado local'], recommended: 'querystring', answer: '' },
  ]))
}

test('o snapshot tem versao de contrato, para o painel saber com o que esta falando', async () => {
  const { snapshotDoMotor, VERSAO_DO_CONTRATO } = await import('../../motor/mir/estado-json')
  const s = snapshotDoMotor()
  expect(s.versao).toBe(VERSAO_DO_CONTRATO)
  expect(s.raizDoEstado).toBe(estado)
  expect(s.geradoEm).toContain('T')
})

test('cada tarefa leva status, fase, url, pr e o que o humano precisa fazer', async () => {
  card('023', { status: 'URL', url: 'http://localhost:5200', cost_usd: '0.42', tokens_total: '52394' })
  const { snapshotDoMotor } = await import('../../motor/mir/estado-json')
  const t = snapshotDoMotor().tarefas[0]
  expect(t?.id).toBe('023')
  expect(t?.status).toBe('URL')
  expect(t?.url).toBe('http://localhost:5200')
  expect(t?.custoUsd).toBe(0.42)
  expect(t?.tokens).toBe(52394)
  expect(t?.esperandoHumano).toBe(true)
  expect(t?.acaoHumana?.motivo).toBeTruthy()
})

test('tarefa em execucao nao aparece como esperando humano', async () => {
  card('023', { status: 'EXECUTING' })
  const { snapshotDoMotor } = await import('../../motor/mir/estado-json')
  const t = snapshotDoMotor().tarefas[0]
  expect(t?.ativa).toBe(true)
  expect(t?.esperandoHumano).toBe(false)
  expect(t?.acaoHumana).toBeNull()
})

test('PERGUNTA ABERTA chega no snapshot com opcoes e recomendada', async () => {
  card('024', { status: 'CLARIFY' })
  clarify('024')
  const { snapshotDoMotor } = await import('../../motor/mir/estado-json')
  const t = snapshotDoMotor().tarefas[0]
  expect(t?.pergunta?.pergunta).toBe('o filtro vem de onde?')
  expect(t?.pergunta?.opcoes).toEqual(['querystring', 'estado local'])
  expect(t?.pergunta?.recomendada).toBe('querystring')
  expect(t?.pergunta?.indice).toBe(0)
  expect(t?.pergunta?.total).toBe(1)
})

test('tarefa sem pergunta aberta traz pergunta nula', async () => {
  card('023', { status: 'EXECUTING' })
  const { snapshotDoMotor } = await import('../../motor/mir/estado-json')
  expect(snapshotDoMotor().tarefas[0]?.pergunta).toBeNull()
})

test('as tarefas saem ordenadas por id e o filtro de repo funciona', async () => {
  card('025', { repo: 'org/outro' })
  card('023')
  card('024')
  const { snapshotDoMotor } = await import('../../motor/mir/estado-json')
  expect(snapshotDoMotor().tarefas.map(t => t.id)).toEqual(['023', '024', '025'])
  expect(snapshotDoMotor({ repo: 'org/app' }).tarefas.map(t => t.id)).toEqual(['023', '024'])
})

test('o snapshot carrega disco, cota e daemon, que o painel mostra junto', async () => {
  const { snapshotDoMotor } = await import('../../motor/mir/estado-json')
  const s = snapshotDoMotor()
  expect(s.disco.nivel).toBe('ok')
  expect(Array.isArray(s.cota.provedores)).toBe(true)
  expect(s.daemon.vivo).toBe(false)
  expect(s.saude).toBeTruthy()
})

test('a revisao muda quando o estado muda, e nao muda quando nada acontece', async () => {
  const { revisaoDoEstado } = await import('../../motor/mir/estado-json')
  card('023')
  const antes = revisaoDoEstado()
  expect(revisaoDoEstado()).toBe(antes)
  card('024', { updated: '2026-08-19T13:00:00Z' })
  expect(revisaoDoEstado()).not.toBe(antes)
})

test('aprovar url move a tarefa e devolve resultado de maquina', async () => {
  card('023', { status: 'URL', url: 'http://localhost:5200' })
  const { executarAcao } = await import('../../motor/mir/comandos-de-tarefa')
  const r = executarAcao('aprovar-url', '023')
  expect(r.ok).toBe(true)
  expect(r.acao).toBe('aprovar-url')
  expect(r.status).toBe('URL_OK')
})

test('aprovar url de tarefa que nao esta em URL recusa, com motivo', async () => {
  card('023', { status: 'EXECUTING' })
  const { executarAcao } = await import('../../motor/mir/comandos-de-tarefa')
  const r = executarAcao('aprovar-url', '023')
  expect(r.ok).toBe(false)
  expect(r.mensagem).toContain('EXECUTING')
})

test('tarefa inexistente devolve erro em vez de estourar', async () => {
  const { executarAcao } = await import('../../motor/mir/comandos-de-tarefa')
  const r = executarAcao('aprovar-url', '999')
  expect(r.ok).toBe(false)
  expect(r.mensagem).toContain('nao encontrado')
  expect(executarAcao('parar', '').ok).toBe(false)
})

test('recusar com motivo pede correcao; sem motivo, refaz', async () => {
  card('023', { status: 'URL', url: 'http://x' })
  const { executarAcao } = await import('../../motor/mir/comandos-de-tarefa')
  expect(executarAcao('recusar', '023', 'o botao ficou fora do lugar').mensagem).toContain('corrigir')
  card('024', { status: 'URL', url: 'http://x' })
  expect(executarAcao('recusar', '024').mensagem).toContain('refazer')
})

test('parar a tarefa registra e devolve o status novo', async () => {
  card('023', { status: 'EXECUTING' })
  const { executarAcao } = await import('../../motor/mir/comandos-de-tarefa')
  const r = executarAcao('parar', '023', 'chega por hoje')
  expect(r.ok).toBe(true)
  expect(r.status).toBe('HALTED')
})

test('RESPONDER a pergunta pela porta de maquina retoma a tarefa', async () => {
  card('024', { status: 'CLARIFY' })
  clarify('024')
  const { executarAcao } = await import('../../motor/mir/comandos-de-tarefa')
  const r = executarAcao('responder', '024', 'querystring')
  expect(r.ok).toBe(true)
  expect(r.mensagem).toContain('querystring')
  expect(r.status).toBe('EXECUTING')
})

test('REGRESSAO: approve/reject/halt nao podem cair no runner (subiam um daemon)', async () => {
  const fonte = await Bun.file('bin/hii.ts').text()
  const trecho = fonte.slice(fonte.indexOf("case 'approve'"), fonte.indexOf("case 'contract'"))
  expect(trecho).toContain('tarefa(')
  expect(trecho).not.toContain('runnerBun')
  expect(fonte).toContain("case 'estado'")
})
