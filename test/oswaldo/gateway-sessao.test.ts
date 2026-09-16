import { test, expect, beforeEach, afterEach } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { submit, submitSession, approvePlan } from '../../motor/mirante/acoes.ts'
import { readCard, patchCard } from '../../motor/cordel/store.ts'
import { registrarPedido } from '../../motor/mirante/execucao-da-sessao.ts'
import { executarGateway } from '../../motor/oswaldo/gateway.ts'
import { pending, reconcileStranded } from '../../motor/oswaldo/mutirao/estado-da-fila.ts'
import { runProvider } from '../../motor/euclides/tesouro/confianca.ts'
import { harnessPorNome } from '../../motor/tomada/registro.ts'
import { lerSessaoHii, iniciarSubsessao } from '../../motor/euclides/sessoes.ts'
import { registrarHarness, esquecerHarness } from '../../motor/tomada/harness-em-voo.ts'
import type { AgentRequest, AgentResult, Harness } from '../../motor/tomada/tipos.ts'

let dir = ''
let anterior: NodeJS.ProcessEnv
beforeEach(() => {
  anterior = { ...process.env }
  dir = mkdtempSync(join(tmpdir(), 'hii-gateway-'))
  process.env.HII_CARDS_DIR = join(dir, 'cards')
  process.env.HII_REPOS_FILE = join(dir, 'repos.json')
  process.env.HII_QUOTA_FALLBACK = 'on'
  mkdirSync(process.env.HII_CARDS_DIR)
  writeFileSync(process.env.HII_REPOS_FILE, JSON.stringify([{ name: 'org/app', path: dir, branch: 'main' }]))
})
afterEach(() => { process.env = anterior; rmSync(dir, { recursive: true, force: true }) })

function pedido(sessao: string, texto = 'mude o arquivo'): string {
  const id = submit({ title: texto, repo: 'org/app', motor_modo: 'gateway', sessao_id: sessao })
  registrarPedido(sessao, id, 'gateway', texto)
  expect(approvePlan(id).ok).toBe(true)
  return id
}

const uso = { tokens_in: 4, tokens_out: 2, tokens_cache_create: 0, tokens_cache_read: 0 }

test('gateway troca na mesma execucao, preserva arquivos e nao reexecuta ao reiniciar', async () => {
  const sessao = submitSession({ title: 'sessao', repo: 'org/app' })
  const id = pedido(sessao)
  const provedores: string[] = []
  await executarGateway(id, {
    chamar: async (card, cwd) => {
      const provedor = card.fm.provider_override_implement || 'claude'
      provedores.push(provedor)
      if (provedor === 'claude') {
        writeFileSync(join(cwd, 'parcial.txt'), 'contexto parcial')
        return { ok: false, cost: '0', costMeasured: false, usage: uso, provider: 'claude', failureClass: 'quota', failureReason: 'limite semanal', reason: 'usage limit reached' }
      }
      expect(readFileSync(join(cwd, 'parcial.txt'), 'utf8')).toBe('contexto parcial')
      expect(card.fm.rota_contexto).toContain('Continue do estado atual')
      return { ok: true, cost: '0', costMeasured: false, usage: uso, provider: 'codex', resultText: 'feito' }
    },
    rota: () => ({ acao: 'trocar', para: 'codex', motivo: 'disponivel' }),
  })
  expect(provedores).toEqual(['claude', 'codex'])
  expect(readCard(id)?.fm.status).toBe('COMPLETED')
  expect(readCard(id)?.fm.worktree).toBeUndefined()
  expect(readCard(id)?.fm.pr_url).toBeUndefined()
  expect(readCard(id)?.fm.tokens_total).toBe('12')
  const log = readFileSync(join(dir, 'cards', 'runs', `${id}.live.log`), 'utf8')
  expect(log).toContain('limite semanal')
  expect(log).toContain('mudando automaticamente para codex')
  expect(readdirSync(join(dir, 'cards', 'runs')).filter(f => f.endsWith('.json')).length).toBe(2)
  reconcileStranded()
  expect(pending()).toEqual([])
  expect(lerSessaoHii(sessao)?.estado).toBe('aberta')
})

test('fila encadeia execucoes e tambem serializa sessions gateway do mesmo projeto', () => {
  const sessao = submitSession({ title: 'primeira', repo: 'org/app' })
  const a = pedido(sessao)
  const b = pedido(sessao)
  const outra = submitSession({ title: 'outra', repo: 'org/app' })
  const c = pedido(outra)
  expect(pending().map(j => j.id)).toEqual([a])
  patchCard(a, { status: 'COMPLETED' })
  expect(pending().map(j => j.id)).toEqual([b])
  patchCard(b, { status: 'COMPLETED' })
  expect(pending().map(j => j.id)).toEqual([c])
})

test('reinicio aguarda o harness vivo e preserva a exclusao por projeto', () => {
  const sessao = submitSession({ title: 'retomada', repo: 'org/app' })
  const id = pedido(sessao)
  iniciarSubsessao(sessao, id, 'codex', '', 'implement')
  pedido(submitSession({ title: 'outra', repo: 'org/app' }))
  registrarHarness(id, process.pid, 'implement')
  try {
    reconcileStranded()
    expect(pending()).toEqual([])
    expect(lerSessaoHii(sessao)?.subsessoes[0]?.estado).toBe('executando')
    expect(readCard(id)?.fm.reconciled).toBeUndefined()
  } finally { esquecerHarness(id, process.pid) }
  reconcileStranded()
  expect(lerSessaoHii(sessao)?.subsessoes[0]?.estado).toBe('interrompida')
  expect(pending().map(j => j.id)).toEqual([id])
})

test('parada humana durante a chamada nao vira concluido nem troca de IA', async () => {
  const id = pedido(submitSession({ title: 'parada', repo: 'org/app' }))
  await executarGateway(id, {
    chamar: async () => {
      patchCard(id, { status: 'HALTED', halt_class: 'humano' })
      return { ok: false, cost: '0', failureClass: 'quota' }
    },
    rota: () => { throw new Error('nao deve rotear apos parada') },
  })
  expect(readCard(id)?.fm.status).toBe('HALTED')
})

test('duas IAs recebem o contexto duravel e deixam subsessoes reais sem ID nativo inventado', async () => {
  const sessao = submitSession({ title: 'contexto', repo: 'org/app' })
  const id = pedido(sessao, 'Preserve a API publica')
  const req: AgentRequest = { prompt: 'continue', cwd: dir, dirs: [dir], mode: 'edit', useAgents: false, timeoutMs: 1000 }
  const resultado: AgentResult = { ok: true, failed: false, timedOut: false, isError: false, detail: '', text: 'API preservada', cost: 0, costMeasured: false, usage: uso }
  for (const nome of ['claude', 'codex']) {
    await runProvider(id, Object.assign(Object.create(harnessPorNome(nome)) as Harness, { run: async (r: AgentRequest) => {
      expect(r.prompt).toContain('Preserve a API publica')
      if (nome === 'codex') expect(r.prompt).toContain('API preservada')
      return resultado
    } }), req, 'implement')
  }
  const s = lerSessaoHii(sessao)!
  expect(s.subsessoes.map(s => s.provedor)).toEqual(['claude', 'codex'])
  expect(s.subsessoes.every(s => s.estado === 'concluida' && s.nativa === null)).toBe(true)
})

test('excecao do harness fecha a subsessao com falha', async () => {
  const sessao = submitSession({ title: 'erro', repo: 'org/app' })
  const id = pedido(sessao)
  let falhou = false
  try {
    await runProvider(id, Object.assign(Object.create(harnessPorNome('codex')) as Harness, { run: async () => { throw new Error('quebrou') } }),
      { prompt: 'x', cwd: dir, dirs: [dir], mode: 'edit', useAgents: false, timeoutMs: 1000 })
  } catch { falhou = true }
  expect(falhou).toBe(true)
  expect(lerSessaoHii(sessao)?.subsessoes[0]?.estado).toBe('falhou')
})
