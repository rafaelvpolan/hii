import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { gastaModelo, abrirRodadaCara } from '../apoio/e2e.ts'
import type { AgentResult } from '../../motor/tmd/tipos.ts'

const TEMPO_TAREFA_OURO_MS = 30_000
const TEMPO_MODELO_REAL_MS = 300_000

const REPO = dirname(dirname(import.meta.dirname))
const BASE = mkdtempSync(join(tmpdir(), 'hii-tarefa-ouro-'))
const BIN = join(BASE, 'bin')
mkdirSync(BIN, { recursive: true })

process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(process.env.HICODE_CARDS_DIR, { recursive: true })
process.env.HICODE_REPOS_FILE = join(BASE, 'repos.json')
process.env.HICODE_IA_FILE = join(BASE, 'ia.json')
process.env.HICODE_AGENTS_DIR = join(REPO, '.claude', 'agents')
process.env.HICODE_PROJECT_MEMORY = 'off'
delete process.env.HICODE_EFFORT
delete process.env.HICODE_AI_PROVIDER
delete process.env.HICODE_IMPLEMENT_PROVIDER
delete process.env.HICODE_STEP_PROVIDER
delete process.env.HICODE_VERIFY_PROVIDER

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

const origem = join(BASE, 'origem.git')
const semente = join(BASE, 'semente')
const clone = join(BASE, 'clone')
mkdirSync(semente, { recursive: true })
execFileSync('git', ['init', '-q', '--bare', origem])
git(semente, ['init', '-q', '.'])
git(semente, ['config', 'user.email', 't@t'])
git(semente, ['config', 'user.name', 't'])
writeFileSync(join(semente, 'soma.test.mjs'), [
  "import test from 'node:test'",
  "import assert from 'node:assert/strict'",
  "import { soma } from './soma.mjs'",
  '',
  "test('soma soma dois numeros', () => {",
  '  assert.strictEqual(soma(2, 3), 5)',
  '})',
  '',
].join('\n'))
git(semente, ['add', '-A'])
git(semente, ['commit', '-qm', 'primeiro'])
git(semente, ['branch', '-M', 'main'])
git(semente, ['remote', 'add', 'origin', origem])
git(semente, ['push', '-q', '-u', 'origin', 'main'])
execFileSync('git', ['--git-dir', origem, 'symbolic-ref', 'HEAD', 'refs/heads/main'])
execFileSync('git', ['clone', '-q', origem, clone])
git(clone, ['config', 'user.email', 't@t'])
git(clone, ['config', 'user.name', 't'])

process.env.HICODE_REPOS_FILE = join(BASE, 'repos.json')
writeFileSync(process.env.HICODE_REPOS_FILE, JSON.stringify([{ name: 'org/tarefa-ouro', path: clone, branch: 'main' }]))

const COMPORTAMENTO_FILE = join(BASE, 'comportamento-implement.txt')
const MARCADOR_AVALIACAO = 'avaliador de qualidade de codigo'
const MARCADOR_ARQUIVO_CRIADO = '+++ b/soma.mjs'
const MARCADOR_FUNCAO_CRIADA = '+export function soma('

function linhaEcho<T>(valor: T): string {
  return `echo '${JSON.stringify(valor)}'`
}

const RESULTADO_AVALIACAO_OK = JSON.stringify({ score: 5, meets: true, notes: 'soma.mjs criado corretamente' })
const RESULTADO_AVALIACAO_FALHA = JSON.stringify({ score: 0, meets: false, notes: 'soma.mjs nao foi criado ou nao exporta soma' })
const LINHA_AVALIACAO_OK = linhaEcho({ total_cost_usd: 0.01, result: RESULTADO_AVALIACAO_OK, is_error: false, usage: { input_tokens: 50, output_tokens: 20 } })
const LINHA_AVALIACAO_FALHA = linhaEcho({ total_cost_usd: 0.01, result: RESULTADO_AVALIACAO_FALHA, is_error: false, usage: { input_tokens: 50, output_tokens: 20 } })
const LINHA_STREAM_INIT = linhaEcho({ type: 'system', subtype: 'init', model: 'falso' })
const LINHA_STREAM_ASSISTANT = linhaEcho({ type: 'assistant', message: { content: [{ type: 'text', text: 'Implementado: funcao soma criada com sucesso.' }] } })
const LINHA_STREAM_RESULT = linhaEcho({ type: 'result', total_cost_usd: 0.02, result: 'Implementado: funcao soma criada com sucesso.', is_error: false })
const LINHA_JSON_IMPLEMENT = linhaEcho({ total_cost_usd: 0.02, result: 'Implementado: funcao soma criada com sucesso.', is_error: false, usage: { input_tokens: 50, output_tokens: 30 } })

const CLAUDE_FALSO = `#!/usr/bin/env bash
if [ "$1" = "mcp" ] && [ "$2" = "list" ]; then
  echo "omc: node /falso/omc-bridge.cjs - Connected"
  exit 0
fi
if [ "$1" = "mcp" ] && [ "$2" = "get" ]; then
  echo "  Scope: User config (available in all your projects)"
  exit 0
fi
PROMPT=""
achou=0
for a in "$@"; do
  if [ "$achou" = "1" ]; then PROMPT="$a"; achou=0; fi
  if [ "$a" = "-p" ]; then achou=1; fi
done
FORMATO=json
for a in "$@"; do if [ "$a" = "stream-json" ]; then FORMATO=stream; fi; done
if [[ "$PROMPT" == *"${MARCADOR_AVALIACAO}"* ]]; then
  if [[ "$PROMPT" == *"${MARCADOR_ARQUIVO_CRIADO}"* && "$PROMPT" == *"${MARCADOR_FUNCAO_CRIADA}"* ]]; then
    ${LINHA_AVALIACAO_OK}
  else
    ${LINHA_AVALIACAO_FALHA}
  fi
  exit 0
fi
COMPORTAMENTO=$(cat "${COMPORTAMENTO_FILE}" 2>/dev/null)
if [ "$COMPORTAMENTO" = "cria-corretamente" ]; then
  cat > soma.mjs <<'EOF'
export function soma(a, b) {
  return a + b
}
EOF
elif [ "$COMPORTAMENTO" = "toca-outra-coisa" ]; then
  echo "notas irrelevantes" > NOTAS.md
fi
if [ "$FORMATO" = "stream" ]; then
  ${LINHA_STREAM_INIT}
  ${LINHA_STREAM_ASSISTANT}
  ${LINHA_STREAM_RESULT}
else
  ${LINHA_JSON_IMPLEMENT}
fi
`

writeFileSync(join(BIN, 'claude'), CLAUDE_FALSO)
chmodSync(join(BIN, 'claude'), 0o755)

const PATH_ORIGINAL = process.env.PATH ?? ''
process.env.PATH = `${BIN}:${PATH_ORIGINAL}`

afterAll(() => {
  process.env.PATH = PATH_ORIGINAL
  rmSync(BASE, { recursive: true, force: true })
})

const { createCard, readCard } = await import('../../motor/cdl/store.ts')
const { handleExecute, tocadosNoWorktree } = await import('../../motor/osw/executar.ts')

let seq = 0

function comportamento(modo: string): void {
  writeFileSync(COMPORTAMENTO_FILE, modo)
}

function cardTarefaOuro(): string {
  return createCard({
    title: 'criar funcao soma',
    status: 'EXECUTING',
    repo: 'org/tarefa-ouro',
    surface: 'api',
    clarified: 'true',
    worktree: join(BASE, `wt-${++seq}`),
  }, [
    '## Objetivo',
    'Criar soma.mjs exportando a funcao soma(a, b) que retorna a soma dos dois numeros,',
    'de forma que o comando `node --test soma.test.mjs` do proprio repo passe.',
    '',
  ].join('\n'))
}

function worktreeDoCard(id: string): string {
  return String(readCard(id)?.fm.worktree ?? '')
}

function envSemContextoDeTesteAninhado(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  delete env.NODE_TEST_WORKER_ID
  return env
}

// `node`, e nao `process.execPath`. O binario que hospeda ESTA suite muda com a
// trilha — sob `bun test`, execPath e o bun, e `bun --test soma.test.mjs` executa o
// arquivo direto, onde `node:test` recusa com "Cannot use test outside of the test
// runner" e sai 1. A pos-condicao passava a depender de quem rodava o teste, e nao
// do trabalho da IA — que e exatamente o contrario do que uma tarefa-ouro mede.
// O comando aqui e o mesmo que o card pede ao agente, palavra por palavra.
function rodarSuiteAlvo(wt: string): { codigo: number; saida: string } {
  try {
    const saida = execFileSync('node', ['--test', 'soma.test.mjs'], { cwd: wt, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: envSemContextoDeTesteAninhado() })
    return { codigo: 0, saida }
  } catch (e) {
    const erro = e as { status?: number | null; stdout?: string; stderr?: string }
    return { codigo: erro.status ?? 1, saida: `${erro.stdout ?? ''}${erro.stderr ?? ''}` }
  }
}

test('TAREFA-OURO: a IA cria soma.mjs de verdade — a pos-condicao mecanica passa e o card registra eval_score/verify coerentes com o que aconteceu no worktree', async () => {
  comportamento('cria-corretamente')
  const id = cardTarefaOuro()
  await handleExecute(id)
  const wt = worktreeDoCard(id)

  expect(existsSync(join(wt, 'soma.mjs')), 'a IA (fake) tinha de ter criado o arquivo pedido no worktree').toBe(true)
  const suite = rodarSuiteAlvo(wt)
  expect(suite.codigo, `a suite alvo (node --test soma.test.mjs) tinha de sair 0: ${suite.saida}`).toBe(0)

  const card = readCard(id)
  expect(card?.fm.status).toBe('URL')
  expect(card?.fm.verify).toBe('sem-dev-server')
  expect(Number(card?.fm.eval_score)).toBeGreaterThanOrEqual(4)
  expect(card?.fm.eval_notes ?? '').toContain('corretamente')
  expect(Number(card?.fm.cost_usd)).toBeGreaterThan(0)
}, TEMPO_TAREFA_OURO_MS)

test('DEFEITO CONHECIDO: a IA nao toca em NENHUM arquivo (diff vazio) e o "nothing to commit" e engolido como se fosse sucesso — o card chega em URL sem que nada tenha acontecido', async () => {
  comportamento('nao-faz-nada')
  const id = cardTarefaOuro()
  await handleExecute(id)
  const wt = worktreeDoCard(id)

  expect(existsSync(join(wt, 'soma.mjs')), 'confirma mecanicamente que a IA nao criou nada').toBe(false)
  const tocados = await tocadosNoWorktree(wt)
  expect(tocados, 'nenhum arquivo foi tocado no worktree — diff vazio, confirmado direto pelo git, sem depender do texto do modelo').toEqual([])
  const suite = rodarSuiteAlvo(wt)
  expect(suite.codigo, 'a pos-condicao mecanica tinha de falhar: soma.mjs nao existe').not.toBe(0)

  const card = readCard(id)
  expect(card?.fm.eval_score, 'o proprio avaliador (LLM) enxerga a ausencia de mudanca no diff e da nota 0').toBe('0')
  expect(
    card?.fm.status,
    'DEFEITO CONHECIDO: o motor nao percebe que a implementacao nao fez NADA — commitAndRecord engole o "nothing to commit" e o card segue para URL exatamente como no teste anterior, que teve sucesso de verdade. Quem so acompanha o status nao distingue os dois casos.',
  ).toBe('URL')
}, TEMPO_TAREFA_OURO_MS)

test('DEFEITO CONHECIDO: o avaliador identifica corretamente que a tarefa NAO foi cumprida (score 0, meets false), mas isso nao muda em nada o desfecho do card', async () => {
  comportamento('toca-outra-coisa')
  const id = cardTarefaOuro()
  await handleExecute(id)
  const wt = worktreeDoCard(id)

  expect(existsSync(join(wt, 'soma.mjs')), 'a IA mexeu em outra coisa, nunca no arquivo pedido').toBe(false)
  expect(existsSync(join(wt, 'NOTAS.md')), 'confirma que ALGO foi commitado desta vez — diferente do teste de diff vazio').toBe(true)
  const suite = rodarSuiteAlvo(wt)
  expect(suite.codigo, 'a pos-condicao mecanica segue falhando: a tarefa pedida nao foi feita').not.toBe(0)

  const card = readCard(id)
  expect(card?.fm.eval_score, 'o avaliador (fake, mas fiel ao DIFF real recebido) contou a verdade sobre o que o diff mostra').toBe('0')
  expect(card?.fm.eval_notes ?? '').toContain('nao foi criado')
  expect(
    card?.fm.status,
    'DEFEITO CONHECIDO: eval_score=0/meets=false nao muda o status do card nem interrompe nada — olhando so a transicao de estado, este card parece IDENTICO ao card do primeiro teste, que teve sucesso de verdade',
  ).toBe('URL')
}, TEMPO_TAREFA_OURO_MS)

test('TAREFA-OURO (trilha paga): a MESMA tarefa contra o modelo real, atras de HICODE_E2E_MODELO_REAL + teto de gasto — e quem detecta o fake/cassete envelhecido', async () => {
  if (!gastaModelo('tarefa-ouro contra modelo real')) return
  const rodada = abrirRodadaCara()
  const pathComFake = process.env.PATH
  process.env.PATH = PATH_ORIGINAL
  try {
    const id = cardTarefaOuro()
    await handleExecute(id)
    const card = readCard(id)
    const wt = worktreeDoCard(id)

    const custoAcumulado: AgentResult = {
      ok: true,
      failed: false,
      timedOut: false,
      isError: false,
      detail: '',
      text: '',
      cost: Number(card?.fm.cost_usd) || 0,
      costMeasured: !card?.fm.cost_unverified,
      usage: { tokens_in: 0, tokens_out: 0, tokens_cache_create: 0, tokens_cache_read: 0 },
    }
    rodada.registrarChamada(custoAcumulado, { papel: 'tarefa-ouro-real' })

    expect(existsSync(join(wt, 'soma.mjs')), 'o modelo REAL tinha de criar soma.mjs de verdade').toBe(true)
    const suite = rodarSuiteAlvo(wt)
    expect(suite.codigo, `suite alvo tinha de sair 0 com o modelo real: ${suite.saida}`).toBe(0)
    expect(card?.fm.status).toBe('URL')
  } finally {
    process.env.PATH = pathComFake
  }
}, TEMPO_MODELO_REAL_MS)
