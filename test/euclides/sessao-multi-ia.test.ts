import { test, expect, beforeEach, afterEach } from '../apoio/runner.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { submitSession, submit } from '../../motor/mirante/acoes.ts'
import { runProvider } from '../../motor/euclides/tesouro/confianca.ts'
import { providerFor } from '../../motor/tomada/registro.ts'
import { emptyUsage } from '../../motor/tomada/uso.ts'
import type { Harness, AgentRequest } from '../../motor/tomada/tipos.ts'
import { registrarMensagem, vincularExecucao, lerSessaoHii } from '../../motor/euclides/sessoes.ts'

let dir = ''
let anterior: NodeJS.ProcessEnv
beforeEach(() => {
  anterior = { ...process.env }
  dir = mkdtempSync(join(tmpdir(), 'hii-multi-ia-'))
  process.env.HII_CARDS_DIR = dir
})
afterEach(() => { process.env = anterior; rmSync(dir, { recursive: true, force: true }) })

function harness(nome: string, executar: (req: AgentRequest) => Promise<string>): Harness {
  const base = providerFor('implement', nome)
  return Object.assign(Object.create(base) as Harness, {
    run: async (req: AgentRequest) => ({
      ok: true, failed: false, timedOut: false, isError: false, detail: '',
      text: await executar(req), cost: 0, costMeasured: true, usage: emptyUsage(),
    }),
  })
}
function pedido(model: string): AgentRequest {
  return { prompt: 'continue', cwd: dir, dirs: [dir], mode: 'edit', useAgents: false, model, timeoutMs: 1000 }
}

test('duas IAs usam a mesma sessao, preservam autoria e historico sobrevive a novo processo', async () => {
  const sessao = submitSession({ title: 'Projeto', repo: 'org/app' })
  const id = submit({ title: 'Implementar', repo: 'org/app', sessao_id: sessao })
  vincularExecucao(sessao, id, 'gateway')
  registrarMensagem(sessao, { autor: 'humano', texto: 'Preservar API v1', execucao: id, provedor: '', modelo: '' })
  await runProvider(id, harness('claude', async req => {
    expect(req.prompt).toContain('Preservar API v1')
    return 'Contrato da API preservado; falta teste de integracao.'
  }), pedido('modelo-a'), 'implement')
  await runProvider(id, harness('codex', async req => {
    expect(req.prompt).toContain('falta teste de integracao')
    expect(req.prompt).toContain('ia/claude/modelo-a')
    return 'Teste de integracao concluido.'
  }), pedido('modelo-b'), 'implement')
  const script = `import { lerSessaoHii } from './motor/euclides/sessoes.ts'; process.stdout.write(JSON.stringify(lerSessaoHii('${sessao}')))`
  const salvo = execFileSync('node', ['--input-type=module', '-e', script], { encoding: 'utf8', env: process.env })
  expect(salvo).toContain('Teste de integracao concluido.')
  const s = lerSessaoHii(sessao)!
  expect(s.subsessoes.map(sub => sub.provedor)).toEqual(['claude', 'codex'])
  expect(s.subsessoes.every(sub => sub.nativa === null && sub.estado === 'concluida')).toBe(true)
  expect(s.execucoes.map(e => e.id)).toEqual([id])
})

test('chamadas simultaneas e excecao nao perdem mensagens nem deixam subsessao executando', async () => {
  const sessao = submitSession({ title: 'Conversa', repo: 'org/app' })
  await Promise.all(['claude', 'codex'].map(nome => runProvider(sessao,
    harness(nome, async () => { await new Promise(resolve => setTimeout(resolve, 5)); return nome }),
    { ...pedido(nome), consultaId: `consulta-${nome}` }, 'conversa')))
  await expect(runProvider(sessao, harness('claude', async () => { throw new Error('interrompida') }),
    pedido('modelo'), 'conversa')).rejects.toThrow('interrompida')
  const s = lerSessaoHii(sessao)!
  expect(s.mensagens.length).toBe(3)
  expect(s.subsessoes.map(sub => sub.estado)).toEqual(['concluida', 'concluida', 'falhou'])
  expect(s.subsessoes.slice(0, 2).map(sub => sub.execucao)).toEqual(['consulta-claude', 'consulta-codex'])
})
