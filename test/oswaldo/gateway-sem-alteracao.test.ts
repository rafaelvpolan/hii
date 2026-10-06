import { test, expect, beforeEach, afterEach } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { submit, submitSession, approvePlan } from '../../motor/mirante/acoes.ts'
import { readCard } from '../../motor/cordel/store.ts'
import { registrarPedido } from '../../motor/mirante/execucao-da-sessao.ts'
import { chamarGateway, executarGateway } from '../../motor/oswaldo/gateway.ts'
import { harnessPorNome } from '../../motor/tomada/registro.ts'
import { aplicar } from '../../motor/tomada/escolha-de-ia.ts'
import type { AgentRequest, AgentResult } from '../../motor/tomada/tipos.ts'

let dir = ''
let anterior: NodeJS.ProcessEnv
const uso = { tokens_in: 4, tokens_out: 2, tokens_cache_create: 0, tokens_cache_read: 0 }
const sucesso: AgentResult = { ok: true, failed: false, timedOut: false, isError: false, detail: '', text: 'feito: adicionei o item', cost: 0, costMeasured: false, usage: uso }

beforeEach(() => {
  anterior = { ...process.env }
  dir = mkdtempSync(join(tmpdir(), 'hii-gateway-prova-'))
  const projeto = join(dir, 'projeto')
  mkdirSync(projeto)
  for (const args of [['init', '-q', '-b', 'main'], ['config', 'user.email', 't@t'], ['config', 'user.name', 't']]) execFileSync('git', args, { cwd: projeto })
  writeFileSync(join(projeto, 'faq.ts'), 'export const faq = []\n')
  execFileSync('git', ['add', '-A'], { cwd: projeto })
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: projeto })
  process.env.HII_CARDS_DIR = join(dir, 'cards')
  process.env.HII_REPOS_FILE = join(dir, 'repos.json')
  process.env.HII_IA_FILE = join(dir, 'ia.json')
  mkdirSync(process.env.HII_CARDS_DIR)
  writeFileSync(process.env.HII_REPOS_FILE, JSON.stringify([{ name: 'org/app', path: projeto, branch: 'main' }]))
  aplicar({ papeis: ['implement'], provider: 'codex' })
})
afterEach(() => { process.env = anterior; rmSync(dir, { recursive: true, force: true }) })

async function rodar(efeito: (req: AgentRequest) => void): Promise<string> {
  const sessao = submitSession({ title: 'sessao', repo: 'org/app' })
  const id = submit({ title: 'acrescente um item no faq', repo: 'org/app', motor_modo: 'gateway', sessao_id: sessao })
  registrarPedido(sessao, id, 'gateway', 'acrescente um item no faq')
  expect(approvePlan(id).ok).toBe(true)
  const h = harnessPorNome('codex')
  const original = h.run
  h.run = async req => { efeito(req); return sucesso }
  try {
    await executarGateway(id, { chamar: chamarGateway, rota: () => ({ acao: 'manter_politica_atual', motivo: 'nenhum candidato apto' }) })
  } finally { h.run = original }
  return id
}

test('IA que diz ter feito mas nao altera nada nao conclui a tarefa', async () => {
  const id = await rodar(() => undefined)
  const fm = readCard(id)?.fm
  expect(fm?.status).toBe('HALTED')
  expect(fm?.halt_reason ?? '').toContain('sem alterar nenhum arquivo')
})

test('IA que altera o projeto conclui a tarefa', async () => {
  const id = await rodar(req => writeFileSync(join(req.cwd, 'faq.ts'), "export const faq = ['novo']\n"))
  expect(readCard(id)?.fm.status).toBe('COMPLETED')
})

test('arquivo do proprio motor em .hii nao conta como alteracao do pedido', async () => {
  const id = await rodar(req => { mkdirSync(join(req.cwd, '.hii', 'ia', 'codex', 'executions'), { recursive: true }); writeFileSync(join(req.cwd, '.hii', 'ia', 'codex', 'executions', 'x.jsonl'), '{}\n') })
  expect(readCard(id)?.fm.status).toBe('HALTED')
})
