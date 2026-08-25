import type { AgentRequest } from '../../motor/tmd/tipos.ts'
import { test, expect, beforeEach } from '../apoio/runner.ts'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hii-modo-'))
  process.env.HICODE_IA_FILE = join(dir, 'ia.json')
  for (const v of ['HICODE_EFFORT', 'HICODE_IMPLEMENT_PROVIDER', 'HICODE_GATE_PROVIDER', 'HICODE_AI_PROVIDER']) {
    delete process.env[v]
  }
})

test('claude, kimi e codex tem catalogo de modos — ollama nao tem nenhum', async () => {
  const { modosDoProvedor, temModos } = await import('../../motor/tmd/modos.ts')
  expect(modosDoProvedor('claude').length).toBeGreaterThan(0)
  expect(modosDoProvedor('kimi').length).toBeGreaterThan(0)
  expect(modosDoProvedor('codex').length).toBeGreaterThan(0)
  expect(temModos('ollama')).toBe(false)
})

test('modoResolvido cai no padrao quando o valor escolhido nao existe no provedor', async () => {
  const { modoResolvido, modoPadraoDoProvedor } = await import('../../motor/tmd/modos.ts')
  expect(modoResolvido('claude', 'nao-existe')).toBe(modoPadraoDoProvedor('claude'))
  expect(modoResolvido('claude', undefined)).toBe(modoPadraoDoProvedor('claude'))
})

test('modoFor do implement resolve o padrao do provedor ativo sem nenhuma preferencia salva', async () => {
  const { modoFor } = await import('../../motor/tmd/registro.ts')
  const { modoPadraoDoProvedor } = await import('../../motor/tmd/modos.ts')
  expect(modoFor('implement')).toBe(modoPadraoDoProvedor('claude'))
})

test('modoFor do ollama e undefined — o provedor nao tem modo nenhum', async () => {
  const { aplicar } = await import('../../motor/mir/escolher-ia.ts')
  const { modoFor } = await import('../../motor/tmd/registro.ts')
  aplicar({ papeis: ['implement'], provider: 'ollama' })
  expect(modoFor('implement')).toBeUndefined()
})

test('REGRESSAO: um modo valido so no provedor antigo nao escapa para o novo provedor', async () => {
  const { aplicar } = await import('../../motor/mir/escolher-ia.ts')
  const { modoFor } = await import('../../motor/tmd/registro.ts')
  const { modoPadraoDoProvedor } = await import('../../motor/tmd/modos.ts')
  aplicar({ papeis: ['implement'], provider: 'claude', modo: 'acceptEdits' })
  expect(modoFor('implement')).toBe('acceptEdits')
  aplicar({ papeis: ['implement'], provider: 'kimi' })
  expect(modoFor('implement')).toBe(modoPadraoDoProvedor('kimi'))
})

test('/mode sem argumento lista os modos da ia atual', async () => {
  const { definirModoDeOperacao } = await import('../../motor/mir/escolher-ia.ts')
  const r = definirModoDeOperacao([])
  expect(r.ok).toBe(false)
  expect(r.mensagem).toContain('acceptEdits')
})

test('/mode define o modo do papel atual', async () => {
  const { definirModoDeOperacao } = await import('../../motor/mir/escolher-ia.ts')
  const { modoFor } = await import('../../motor/tmd/registro.ts')
  definirModoDeOperacao(['plan'])
  expect(modoFor('implement')).toBe('plan')
})

test('/mode <papel> <modo> mira o papel pedido', async () => {
  const { definirModoDeOperacao, aplicar } = await import('../../motor/mir/escolher-ia.ts')
  const { modoFor } = await import('../../motor/tmd/registro.ts')
  aplicar({ papeis: ['step'], provider: 'claude' })
  definirModoDeOperacao(['step', 'plan'])
  expect(modoFor('step')).toBe('plan')
  expect(modoFor('implement')).not.toBe('plan')
})

test('/mode recusa modo invalido do provedor em vez de mandar lixo para o CLI', async () => {
  const { definirModoDeOperacao } = await import('../../motor/mir/escolher-ia.ts')
  const { modoFor } = await import('../../motor/tmd/registro.ts')
  const r = definirModoDeOperacao(['modo-que-nao-existe'])
  expect(r.ok).toBe(false)
  expect(modoFor('implement')).not.toBe('modo-que-nao-existe')
})

test('/mode recusa quando o provedor atual nao tem modo de operacao', async () => {
  const { definirModoDeOperacao, aplicar } = await import('../../motor/mir/escolher-ia.ts')
  aplicar({ papeis: ['implement'], provider: 'ollama' })
  const r = definirModoDeOperacao(['auto'])
  expect(r.ok).toBe(false)
  expect(r.mensagem).toContain('nao tem modo')
})

test('/mode padrao volta ao modo padrao do provedor', async () => {
  const { definirModoDeOperacao } = await import('../../motor/mir/escolher-ia.ts')
  const { modoFor } = await import('../../motor/tmd/registro.ts')
  const { modoPadraoDoProvedor } = await import('../../motor/tmd/modos.ts')
  definirModoDeOperacao(['plan'])
  definirModoDeOperacao(['padrao'])
  expect(modoFor('implement')).toBe(modoPadraoDoProvedor('claude'))
})

test('ciclarModo passa pelos modos do provedor ativo e da a volta', async () => {
  const { ciclarModo } = await import('../../motor/mir/escolher-ia.ts')
  const { modoFor } = await import('../../motor/tmd/registro.ts')
  const { modosDoProvedor } = await import('../../motor/tmd/modos.ts')
  const total = modosDoProvedor('claude').length
  const inicial = modoFor('implement')
  const vistos = new Set<string | undefined>([inicial])
  for (let i = 1; i < total; i++) {
    ciclarModo('implement', 1)
    vistos.add(modoFor('implement'))
  }
  expect(vistos.size).toBe(total)
  ciclarModo('implement', 1)
  expect(modoFor('implement')).toBe(inicial)
})

test('ciclarModo do ollama avisa que o provedor nao tem modo, sem quebrar', async () => {
  const { ciclarModo, aplicar } = await import('../../motor/mir/escolher-ia.ts')
  aplicar({ papeis: ['implement'], provider: 'ollama' })
  const r = ciclarModo('implement', 1)
  expect(r.ok).toBe(false)
  expect(r.mensagem).toContain('nao tem modo')
})

test('autocompletar de /mode oferece os modos da ia atual', async () => {
  const { complete } = await import('../../motor/mir/completar.ts')
  const { agentRoles } = await import('../../motor/tmd/registro.ts')
  const { modosDoProvedor } = await import('../../motor/tmd/modos.ts')
  const ctx = { repos: [], cards: [], modos: [...modosDoProvedor('claude')], papeis: agentRoles() }
  expect(complete('/mode ', ctx)[0]).toContain('plan')
})

test('claudeArgv sem modo escolhido preserva o comportamento de hoje: acceptEdits', async () => {
  const { claudeArgv } = await import('../../motor/tmd/harness/claude-argv.ts')
  const req = { prompt: 'x', cwd: '/tmp', dirs: [], mode: 'edit' as const, useAgents: false, timeoutMs: 1 }
  const argv = claudeArgv(req)
  expect(argv).toContain('--permission-mode')
  expect(argv[argv.indexOf('--permission-mode') + 1]).toBe('acceptEdits')
})

test('claudeArgv no modo "default" nao manda --permission-mode nenhum', async () => {
  const { claudeArgv } = await import('../../motor/tmd/harness/claude-argv.ts')
  const req = { prompt: 'x', cwd: '/tmp', dirs: [], mode: 'edit' as const, useAgents: false, timeoutMs: 1, modo: 'default' }
  expect(claudeArgv(req)).not.toContain('--permission-mode')
})

test('claudeArgv repassa o modo escolhido direto para --permission-mode', async () => {
  const { claudeArgv } = await import('../../motor/tmd/harness/claude-argv.ts')
  const req = { prompt: 'x', cwd: '/tmp', dirs: [], mode: 'edit' as const, useAgents: false, timeoutMs: 1, modo: 'plan' }
  const argv = claudeArgv(req)
  expect(argv[argv.indexOf('--permission-mode') + 1]).toBe('plan')
})

test('claudeArgv readonly nunca manda --permission-mode, mesmo com modo escolhido', async () => {
  const { claudeArgv } = await import('../../motor/tmd/harness/claude-argv.ts')
  const req = { prompt: 'x', cwd: '/tmp', dirs: [], mode: 'readonly' as const, useAgents: false, timeoutMs: 1, modo: 'plan' }
  expect(claudeArgv(req)).not.toContain('--permission-mode')
})

// O kimi nao entra no esquema de "modo vira flag" dos outros provedores: em
// execucao unica (`-p`, que e como o motor sempre chama) o CLI 0.38.0 recusa
// --auto, --yolo e --plan, abortando em ~1s sem tocar em arquivo. Sem flag nenhum
// ele ja executa e aprova as ferramentas sozinho.
test('REGRESSAO kimiArgv nao carrega flag de modo, escolhido ou padrao', async () => {
  const { kimiArgv } = await import('../../motor/tmd/harness/kimi.ts')
  const base = { prompt: 'x', cwd: '/tmp', dirs: [], mode: 'edit' as const, useAgents: false, timeoutMs: 1 }
  const semModo = kimiArgv(base)
  for (const flag of ['--auto', '--yolo', '--plan']) expect(semModo, flag).not.toContain(flag)
  for (const modo of ['auto', 'yolo', 'plan', 'default']) {
    expect(kimiArgv({ ...base, modo }), `modo "${modo}" nao pode virar flag`).toEqual(semModo)
  }
})

test('REGRESSAO codex: approval_policy troca de lugar do -a quebrado e respeita o modo, com "never" como padrao de hoje', async () => {
  // Antes isto olhava o texto-fonte atras de `modoResolvido('codex'`, e por isso
  // reprovou num refactor que preservou o comportamento. Agora exercita o argv:
  // mais forte que grep, e nao amarra o teste a como o modo e resolvido.
  const { argv } = await import('../../motor/tmd/harness/codex.ts')
  const pedido = (modo?: string): AgentRequest => ({
    prompt: 'p', cwd: '/tmp', dirs: ['/tmp'], mode: 'edit', useAgents: false, timeoutMs: 1000, modo,
  })
  const semModo = argv(pedido(), '/tmp')
  expect(semModo).toContain('approval_policy="never"')
  expect(semModo.some((a, i) => a === '-a' && semModo[i + 1] === 'never')).toBe(false)
  expect(argv(pedido('untrusted'), '/tmp')).toContain('approval_policy="untrusted"')
  expect(argv(pedido('modo-que-nao-existe'), '/tmp')).toContain('approval_policy="never"')
})

test('o papel step tambem envia o modo — ele edita arquivos como o implement', async () => {
  const { papelHonraModo } = await import('../../motor/tmd/modos.ts')
  expect(papelHonraModo('implement')).toBe(true)
  expect(papelHonraModo('step')).toBe(true)
})

test('REGRESSAO /mode recusa papel que roda em leitura, em vez de gravar preferencia inerte', async () => {
  const { definirModoDeOperacao } = await import('../../motor/mir/escolher-ia.ts')
  for (const papel of ['verify', 'gate']) {
    const r = definirModoDeOperacao([papel, 'plan'])
    expect(r.ok).toBe(false)
    expect(r.mensagem).toContain('leitura')
  }
})

test('REGRESSAO shift+tab num papel de leitura nao cicla modo nenhum', async () => {
  const { ciclarModo } = await import('../../motor/mir/escolher-ia.ts')
  expect(ciclarModo('gate', 1).ok).toBe(false)
})
