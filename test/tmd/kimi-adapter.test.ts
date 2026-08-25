import { test, expect, afterAll } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { KimiProvider, KIMI_CAPACIDADES, kimiArgv } from '../../motor/tmd/harness/kimi.ts'
import { isProviderName, modelFor, providerLimits, providerNames } from '../../motor/tmd/registro.ts'
import type { AgentMode, AgentRequest } from '../../motor/tmd/tipos.ts'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-kimi-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(process.env.HICODE_CARDS_DIR, { recursive: true })

const binDir = join(BASE, 'bin')
mkdirSync(binDir, { recursive: true })
const argvFile = join(BASE, 'argv.txt')
process.env.KIMI_ARGV_FILE = argvFile

const FAKE = `#!/usr/bin/env bash
: > "$KIMI_ARGV_FILE"
for a in "$@"; do printf '%s\\0' "$a" >> "$KIMI_ARGV_FILE"; done
cat <<'FIM'
{"role":"meta","type":"system.version","version":"9.9.9"}
{"role":"assistant","content":"vou olhar os arquivos"}
{"role":"tool","tool_call_id":"t1","content":"conteudo lido"}
{"role":"assistant","content":"resposta final do kimi"}
{"role":"meta","type":"session.resume_hint","session_id":"s1","command":"kimi -r s1","content":"To resume this session: kimi -r s1"}
FIM
if [ -n "$KIMI_FAKE_FAIL" ]; then
  printf '%s\\n' '{"role":"meta","type":"turn.step.retrying","failed_attempt":1,"next_attempt":2,"max_attempts":3,"delay_ms":500,"error_name":"RateLimitError","error_message":"too many requests","status_code":429}'
  echo 'kimi: turn failed' >&2
  exit 3
fi
`

const caminhoFake = join(binDir, 'kimi')
writeFileSync(caminhoFake, FAKE)
chmodSync(caminhoFake, 0o755)

const pathOriginal = process.env.PATH ?? ''
process.env.PATH = `${binDir}:${pathOriginal}`

afterAll(() => {
  process.env.PATH = pathOriginal
  delete process.env.KIMI_ARGV_FILE
  delete process.env.KIMI_FAKE_FAIL
  rmSync(BASE, { recursive: true, force: true })
})

const FLAGS_INEXISTENTES = ['--allowedTools', '--allowed-tools', '--effort', '--permission-mode', '--sandbox', '--json', '-C']
// `--auto`, `--yolo` e `--plan` entram aqui por MEDICAO contra o CLI real (0.38.0):
// combinados com `-p` o binario aborta em ~1s ("Cannot combine --prompt with --X"),
// sem tocar em arquivo. Sao flags de sessao interativa.
const FLAGS_REAIS_QUE_NAO_USAMOS = ['-y', '--yolo', '--auto', '--plan', '--agent', '--agent-file', '--skills-dir', '-S', '--session', '-c', '--continue']

function pedido(mode: AgentMode, extra?: Partial<AgentRequest>): AgentRequest {
  return { prompt: 'faca algo', cwd: BASE, dirs: [], mode, useAgents: false, timeoutMs: 20000, ...extra }
}

function argvDoDisco(): string[] {
  if (!existsSync(argvFile)) return []
  return readFileSync(argvFile, 'utf8').split('\0').filter(s => s.length > 0)
}

test('argv do modo edit nao carrega nenhuma flag que o CLI do kimi nao tem', () => {
  const a = kimiArgv(pedido('edit'))
  expect(a).toEqual(['-p', 'faca algo', '--output-format', 'stream-json'])
  for (const flag of FLAGS_INEXISTENTES) expect(a).not.toContain(flag)
})

test('flags que o CLI TEM mas o motor nao usa ficam de fora de proposito', () => {
  const a = kimiArgv(pedido('edit', { model: 'kimi-k2', effort: 'high' }))
  for (const flag of FLAGS_REAIS_QUE_NAO_USAMOS) expect(a).not.toContain(flag)
})

// `-p` aprova as ferramentas sozinho: medido, o kimi ESCREVEU o arquivo sem flag
// nenhum. Entao "readonly" nao restringe nada nele — o que protege e o motor recusar
// o papel, nao um argumento de linha de comando.
test('modo readonly nao protege nada no kimi, e o motor recusa o papel em vez de fingir', async () => {
  const { recusaPorLimite } = await import('../../motor/euc/tsr/confianca.ts')
  expect(kimiArgv(pedido('readonly'))).toEqual(kimiArgv(pedido('edit')))
  expect(KIMI_CAPACIDADES.isolatesReadonly).toBe(false)
  expect(KIMI_CAPACIDADES.restrictsTools).toBe(false)
  expect(recusaPorLimite(new KimiProvider(), pedido('readonly'))).toContain('somente-leitura')
})

// REGRESSAO medida contra o CLI real. A versao anterior deste teste afirmava o
// CONTRARIO — "sem --auto o CLI trava esperando aprovacao que ninguem pode dar" — e
// passava, porque nunca executou o binario. O que acontece de verdade com `-p
// --auto` e abortar em ~1s: todo passo de implementacao no kimi falhava.
test('REGRESSAO: modo edit NAO ganha --auto — com ele o CLI aborta', () => {
  expect(kimiArgv(pedido('edit'))).not.toContain('--auto')
})

// Catalogo de um modo so: oferecer escolha que nunca vira flag seria valor calculado
// e nunca aplicado.
test('o catalogo de modos anuncia so o que o CLI aceita em execucao unica', async () => {
  const { KIMI_MODOS } = await import('../../motor/tmd/harness/kimi.ts')
  expect(KIMI_MODOS.modos).toEqual(['default'])
  expect(KIMI_MODOS.padrao).toBe('default')
  for (const modo of ['auto', 'yolo', 'plan']) {
    expect(kimiArgv(pedido('edit', { modo })), `modo "${modo}" nao pode virar flag`).toEqual(kimiArgv(pedido('edit')))
  }
})

test('--output-format usa stream-json (o CLI so aceita text|stream-json, "json" nao existe)', () => {
  const a = kimiArgv(pedido('edit'))
  const i = a.indexOf('--output-format')
  expect(i).toBeGreaterThanOrEqual(0)
  expect(a[i + 1]).toBe('stream-json')
  expect(a).not.toContain('json')
})

test('--add-dir se repete uma vez por diretorio, na ordem recebida', () => {
  const a = kimiArgv(pedido('edit', { dirs: ['/wt/um', '/wt/dois', '/wt/tres'] }))
  expect(a.filter(x => x === '--add-dir')).toHaveLength(3)
  expect(a.slice(a.indexOf('--add-dir'))).toEqual(['--add-dir', '/wt/um', '--add-dir', '/wt/dois', '--add-dir', '/wt/tres'])
})

test('effort e ignorado: nao existe --effort no kimi, e o argv nao muda por causa dele', () => {
  const semEffort = kimiArgv(pedido('edit'))
  const comEffort = kimiArgv(pedido('edit', { effort: 'xhigh' }))
  expect(comEffort).toEqual(semEffort)
  expect(comEffort).not.toContain('xhigh')
  expect(KIMI_CAPACIDADES.acceptsEffort).toBe(false)
})

test('useAgents e extraTools nao viram flag — sem --allowedTools nao ha o que restringir', () => {
  const a = kimiArgv(pedido('edit', { useAgents: true, extraTools: ['WebFetch', 'Task'] }))
  expect(a).toEqual(['-p', 'faca algo', '--output-format', 'stream-json'])
  expect(a).not.toContain('WebFetch')
  expect(a).not.toContain('Task')
})

test('modelo vira -m quando pedido, e desaparece quando nao ha modelo', () => {
  expect(kimiArgv(pedido('edit', { model: 'kimi-k2' }))).toContain('-m')
  expect(kimiArgv(pedido('edit', { model: 'kimi-k2' })).at(-1)).toBe('kimi-k2')
  expect(kimiArgv(pedido('edit'))).not.toContain('-m')
})

test('o kimi aparece no registry ao lado de claude/codex/ollama', () => {
  expect(providerNames()).toContain('kimi')
  expect(isProviderName('kimi')).toBe(true)
  expect(providerNames().filter(n => n === 'kimi')).toHaveLength(1)
})

test('HICODE_KIMI_MODEL escolhe o modelo do kimi por papel', () => {
  const anterior = process.env.HICODE_KIMI_MODEL
  process.env.HICODE_KIMI_MODEL = 'kimi-k2-turbo'
  try {
    expect(modelFor('step', 'kimi')).toBe('kimi-k2-turbo')
  } finally {
    if (anterior === undefined) delete process.env.HICODE_KIMI_MODEL
    else process.env.HICODE_KIMI_MODEL = anterior
  }
})

test('as limitacoes do kimi ficam visiveis pelo registry — o motor ve, nao adivinha', () => {
  expect(providerLimits('kimi')).toEqual(KIMI_CAPACIDADES)
  expect(providerLimits('kimi').reportsCostUsd).toBe(false)
})

test('rodada de sucesso: texto vem da ultima mensagem assistant do stream-json', async () => {
  const res = await new KimiProvider().run(pedido('edit', { dirs: [BASE] }))
  expect(res.ok).toBe(true)
  expect(res.failed).toBe(false)
  expect(res.isError).toBe(false)
  expect(res.text).toBe('resposta final do kimi')
  expect(res.detail).toBe('')
})

test('custo NAO MEDIDO: o stream-json do kimi nao traz custo nem token, e o adaptador nao inventa numero', async () => {
  const res = await new KimiProvider().run(pedido('readonly', { dirs: [BASE] }))
  expect(res.cost).toBe(0)
  expect(res.costMeasured).toBe(false)
  expect(res.usage).toEqual({ tokens_in: 0, tokens_out: 0, tokens_cache_create: 0, tokens_cache_read: 0 })
})

test('o argv que chega no CLI de verdade nao tem flag inventada e leva o prompt como um unico argumento', async () => {
  await new KimiProvider().run(pedido('edit', { prompt: 'conserte o botao azul', dirs: [BASE, join(BASE, 'bin')], model: 'kimi-k2' }))
  const a = argvDoDisco()
  expect(a).toEqual(['-p', 'conserte o botao azul', '--output-format', 'stream-json', '-m', 'kimi-k2', '--add-dir', BASE, '--add-dir', join(BASE, 'bin')])
  for (const flag of FLAGS_INEXISTENTES) expect(a).not.toContain(flag)
})

test('falha do CLI reprova a rodada e o motivo da tentativa perdida entra no detail', async () => {
  process.env.KIMI_FAKE_FAIL = '1'
  try {
    const res = await new KimiProvider().run(pedido('edit', { dirs: [BASE] }))
    expect(res.ok).toBe(false)
    expect(res.failed).toBe(true)
    expect(res.timedOut).toBe(false)
    expect(res.detail).toContain('RateLimitError')
    expect(res.detail).toContain('429')
    expect(res.costMeasured).toBe(false)
  } finally {
    delete process.env.KIMI_FAKE_FAIL
  }
})

test('as capacidades declaradas batem com o que o --help do kimi mostra', () => {
  const p = new KimiProvider()
  expect(p.name).toBe('kimi')
  expect(p.agentic).toBe(true)
  expect(p.supportsAgents).toBe(false)
  expect(p.supportsVision).toBe(false)
})

test('kimi nao tem --agents: --agent/--agent-file selecionam UM perfil de sessao pre-existente, nao injetam o catalogo Nexus por chamada', () => {
  const a = kimiArgv(pedido('edit', { agentsJson: '{"limpio":{"description":"d","prompt":"p"}}' }))
  expect(a).not.toContain('--agents')
  expect(a).not.toContain('--agent')
  expect(a).not.toContain('--agent-file')
})
