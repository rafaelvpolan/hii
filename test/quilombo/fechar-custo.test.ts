import { TEMPO_COM_GIT_MS } from '../tempo-de-teste.ts'
import { test, expect, afterAll, lerArquivo } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { GateResult } from '../../motor/ciclo/crivo/gate.ts'
import type { ImplementResult } from '../../motor/cordel/index.ts'
import type { StepResult } from '../../motor/ciclo/agente.ts'
import type { ExecuteDeps } from '../../motor/oswaldo/executar.ts'
import type { FinishDeps } from '../../motor/quilombo/cartorio/fechar.ts'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-finishcost-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(process.env.HICODE_CARDS_DIR, { recursive: true })

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
writeFileSync(join(semente, 'a.txt'), 'um\n')
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
writeFileSync(process.env.HICODE_REPOS_FILE, JSON.stringify([{ name: 'org/repo', path: clone, branch: 'main' }]))

let implementCalls = 0

const FALHA: ImplementResult = { ok: false, reason: 'falha simulada (transiente)', cost: '0.1000', usage: { tokens_in: 40, tokens_out: 60, tokens_cache_create: 0, tokens_cache_read: 0 } }
const SUCESSO: ImplementResult = { ok: true, resultText: 'mudou algo', fullText: 'mudou algo', cost: '0.2500', usage: { tokens_in: 70, tokens_out: 130, tokens_cache_create: 0, tokens_cache_read: 0 } }

const GATE_BLOCKED: GateResult = { ok: true, verdict: 'BLOCKED', reason: 'defeito real encontrado pelo crivo', criterio: '', questions: [], cost: 0.05, costMeasured: true, tokens: 500 }

const { createCard, readCard, patchCard } = await import('../../motor/cordel/store.ts')
const { handleExecute } = await import('../../motor/oswaldo/executar.ts')
const { handleFinish } = await import('../../motor/quilombo/cartorio/fechar.ts')
const core = await import('../../motor/mirante/acoes.ts')

const agenteExecute: ExecuteDeps = {
  implement: (): Promise<ImplementResult> => {
    implementCalls++
    return Promise.resolve(implementCalls === 1 ? FALHA : SUCESSO)
  },
  verifyVisual: (): Promise<never> => Promise.reject(new Error('nao deveria chamar verifyVisual')),
}

const agenteFinish: FinishDeps = {
  runStep: (): never => { throw new Error('nao deveria chamar runStep — steps: nada nao roda nenhum passo') },
  runCodefoxGate: (): Promise<GateResult> => Promise.resolve(GATE_BLOCKED),
}

afterAll(() => rmSync(BASE, { recursive: true, force: true }))

let seq = 0

function worktreeParaTeste(): string {
  return join(BASE, `wt-${++seq}`)
}

test('REGRESSAO: custo do card NUNCA decresce ao longo de execute->halt->resume->execute->finish(halt)', async () => {
  const wt = worktreeParaTeste()
  const id = createCard({
    title: 'ajuste no rodape',
    status: 'EXECUTING',
    repo: 'org/repo',
    surface: 'none',
    clarified: 'true',
    steps: 'nada',
    worktree: wt,
  }, '## Objetivo\najustar o rodape\n')

  await handleExecute(id, agenteExecute)
  const apos1aFalha = readCard(id)
  expect(apos1aFalha?.fm.status).toBe('HALTED')
  expect(apos1aFalha?.fm.cost_usd).toBe('0.1000')
  expect(apos1aFalha?.fm.tokens_total).toBe('100')

  core.transition(id, 'EXECUTING', 'retomado pelo humano (teste)')
  await handleExecute(id, agenteExecute)
  const apos2aExecucao = readCard(id)
  expect(apos2aExecucao?.fm.status).toBe('URL')
  patchCard(id, { status: 'URL_OK' }, 'funcionalidade aprovada pelo humano (teste)')
  expect(apos2aExecucao?.fm.cost_usd).toBe('0.3500')
  expect(apos2aExecucao?.fm.tokens_total).toBe('300')
  expect(parseFloat(apos2aExecucao?.fm.cost_usd ?? '0')).toBeGreaterThanOrEqual(parseFloat(apos1aFalha?.fm.cost_usd ?? '0'))

  // O fecho de tarefa NAO-VISUAL agora para e PERGUNTA antes de empurrar o PR
  // ("resolveu o problema? posso encerrar?"): o humano nunca viu isto rodando. A
  // parada nao pode custar nada nem perder o que ja foi gasto.
  await handleFinish(id, agenteFinish)
  const noPedidoDeConfirmacao = readCard(id)
  expect(noPedidoDeConfirmacao?.fm.status).toBe('CONFIRM')
  expect(noPedidoDeConfirmacao?.fm.cost_usd).toBe('0.3500')
  expect(noPedidoDeConfirmacao?.fm.tokens_total).toBe('300')

  const confirmado = core.confirmarFecho(id)
  expect(confirmado.ok, confirmado.reason).toBe(true)
  expect(readCard(id)?.fm.status).toBe('URL_OK')

  await handleFinish(id, agenteFinish)
  const apos3oGateBloqueado = readCard(id)
  expect(apos3oGateBloqueado?.fm.status).toBe('HALTED')
  expect(apos3oGateBloqueado?.fm.cost_usd).toBe('0.4000')
  expect(apos3oGateBloqueado?.fm.tokens_total).toBe('800')
  expect(parseFloat(apos3oGateBloqueado?.fm.cost_usd ?? '0')).toBeGreaterThanOrEqual(parseFloat(apos2aExecucao?.fm.cost_usd ?? '0'))
  expect(existsSync(wt)).toBe(true)
}, TEMPO_COM_GIT_MS)

// Dois passos NAO-gated, para o laco rodar sem chamar o crivo de verdade:
// runGatedReview nao entra em FinishDeps, entao passo gated aqui bateria na rede.
// loadPipeline le <worktree>/.hii/pipeline.json antes do config/ do repo, que e o
// gancho previsto para o alvo mandar no proprio pipeline.
const PIPELINE_DE_DOIS_PASSOS = {
  version: 1,
  steps: [
    { id: 'passo_um', label: 'PassoUm', kind: 'quality', agent: 'pura', state: 'REFINED', gate: 'none', enabled: true, needs: [], instruction: 'primeiro passo de: "%s"' },
    { id: 'passo_dois', label: 'PassoDois', kind: 'cleanup', agent: 'pura', state: 'CLEANED', gate: 'none', enabled: true, needs: [], instruction: 'segundo passo de: "%s"' },
  ],
}

test('REGRESSAO o teto de orcamento e conferido DENTRO do laco de passos, e o custo do passo vai para o frontmatter', async () => {
  const wt = worktreeParaTeste()
  const id = createCard({
    title: 'dois passos caros',
    status: 'EXECUTING',
    repo: 'org/repo',
    surface: 'none',
    clarified: 'true',
    steps: 'passo_um,passo_dois',
    // O pipeline virou manual por padrao (pausa antes do primeiro passo); este
    // teste existe para o LACO automatico, entao declara o modo que exercita.
    pipeline: 'auto',
    worktree: wt,
  }, '## Objetivo\ndois passos\n')

  // Uma execucao so, bem-sucedida: deixa o card em 0.2500 e cria o worktree.
  implementCalls = 1
  await handleExecute(id, agenteExecute)
  expect(readCard(id)?.fm.status).toBe('URL')
  expect(readCard(id)?.fm.cost_usd).toBe('0.2500')

  mkdirSync(join(wt, '.hii'), { recursive: true })
  writeFileSync(join(wt, '.hii', 'pipeline.json'), JSON.stringify(PIPELINE_DE_DOIS_PASSOS))

  let passosRodados = 0
  const agenteDeDoisPassos: FinishDeps = {
    runStep: (): Promise<StepResult> => {
      passosRodados++
      return Promise.resolve({ time: 1, cost: 0.1, costMeasured: true, tokens: 100, text: 'passo feito', ok: true })
    },
    runCodefoxGate: (): Promise<GateResult> => Promise.resolve(GATE_BLOCKED),
  }

  // Teto acima do gasto de entrada (0.2500) e abaixo do gasto DEPOIS do primeiro
  // passo (0.3500). Assim a guarda da entrada do handler passa, e so a guarda de
  // dentro do laco pode barrar — que e exatamente o que este teste existe para provar.
  const tetoAnterior = process.env.HICODE_CARD_BUDGET_USD
  process.env.HICODE_CARD_BUDGET_USD = '0.30'
  try {
    patchCard(id, { status: 'URL_OK' }, 'aprovado pelo humano (teste)')
    await handleFinish(id, agenteDeDoisPassos)
    if (readCard(id)?.fm.status === 'CONFIRM') {
      expect(core.confirmarFecho(id).ok).toBe(true)
      await handleFinish(id, agenteDeDoisPassos)
    }
  } finally {
    if (tetoAnterior === undefined) delete process.env.HICODE_CARD_BUDGET_USD
    else process.env.HICODE_CARD_BUDGET_USD = tetoAnterior
  }

  const fim = readCard(id)
  expect(passosRodados, 'o segundo passo nao podia ter sido pago: o teto ja tinha estourado').toBe(1)
  expect(fim?.fm.status).toBe('HALTED')
  // Sem accumulatedTotals no patch de sucesso do passo, isto seguiria em 0.2500 —
  // e a guarda acima nunca teria como enxergar o gasto do primeiro passo.
  expect(fim?.fm.cost_usd, 'o custo do passo tem de chegar ao frontmatter, nao so ao texto do diario').toBe('0.3500')
  expect(fim?.body, 'o diario tem de dizer que a parada foi DENTRO do laco — senao parece o guard da entrada').toContain('dentro do laco de passos')
}, TEMPO_COM_GIT_MS)

// O predicado puro decide apenas UMA LINHA DE LOG. Quem de fato impede o segundo
// PR e o `if (prExistente) return prExistente` dentro de executarComIdempotencia,
// e apagar ESSE guard mantinha este teste verde — ele nao podia falhar pelo
// defeito que nomeia.
test('REGRESSAO card com PR ja aberto nao tenta criar PR de novo', async () => {
  const { pularCriacaoDePr } = await import('../../motor/quilombo/cartorio/pr.ts')
  expect(pularCriacaoDePr('https://github.com/o/r/pull/20')).toBe(true)
  expect(pularCriacaoDePr('')).toBe(false)
  expect(pularCriacaoDePr('   ')).toBe(false)

  // O guard de verdade mora em abrirPrUmaVez, e e exercitado por COMPORTAMENTO nos
  // tres testes abaixo. Aqui fica so o elo: o fecho tem de USAR aquela funcao, e
  // nao reabrir o gh por conta propria.
  const fonte = await lerArquivo('motor/quilombo/cartorio/fechar.ts')
  expect(fonte, 'o fecho tem de delegar a abertura').toContain('abrirPrUmaVez(')
  expect(fonte, 'gh pr create fora de abrirPrUmaVez e um segundo caminho sem guarda').not.toContain("'pr', 'create'")
}, TEMPO_COM_GIT_MS)

// A guarda contra o SEGUNDO PR era verificavel so por leitura de texto-fonte:
// apontar `prExistente` para um campo que ninguem escreve mantinha as assercoes de
// existencia e de ordem verdadeiras, e o segundo `gh pr create` voltava. Agora a
// abertura vive em abrirPrUmaVez, com `executar` injetavel.
test('COMPORTAMENTO card com pr_url NAO chama o gh de novo', async () => {
  const { abrirPrUmaVez } = await import('../../motor/quilombo/cartorio/pr.ts')
  let chamadas = 0
  const ghFalso = async (): Promise<{ err: null; stdout: string; stderr: string }> => {
    chamadas++
    return { err: null, stdout: 'https://github.com/o/r/pull/99\n', stderr: '' }
  }
  const pedido = {
    card: 'pr-existente', repoName: 'o/r', base: 'main', branch: 'b',
    titulo: 't', corpo: 'c', worktree: '/tmp', prExistente: 'https://github.com/o/r/pull/20',
  }
  const r = await abrirPrUmaVez(pedido, ghFalso as unknown as typeof import('../../motor/quilombo/git.ts').run)
  expect(chamadas, 'o gh foi chamado num card que ja tem PR: o segundo PR volta assim').toBe(0)
  expect(r.url).toBe('https://github.com/o/r/pull/20')
  expect(r.reaproveitada).toBe(true)
})

test('COMPORTAMENTO card SEM pr_url chama o gh uma vez, e a chave impede a segunda', async () => {
  const { abrirPrUmaVez } = await import('../../motor/quilombo/cartorio/pr.ts')
  let chamadas = 0
  const ghFalso = async (): Promise<{ err: null; stdout: string; stderr: string }> => {
    chamadas++
    return { err: null, stdout: 'https://github.com/o/r/pull/77\n', stderr: '' }
  }
  const pedido = {
    card: 'pr-novo', repoName: 'o/r', base: 'main', branch: 'b',
    titulo: 't', corpo: 'c', worktree: '/tmp', prExistente: '',
  }
  const tipo = ghFalso as unknown as typeof import('../../motor/quilombo/git.ts').run
  const primeira = await abrirPrUmaVez(pedido, tipo)
  expect(chamadas).toBe(1)
  expect(primeira.url).toBe('https://github.com/o/r/pull/77')
  expect(primeira.reaproveitada).toBe(false)

  const segunda = await abrirPrUmaVez(pedido, tipo)
  expect(chamadas, 'a chave de idempotencia tem de impedir a segunda abertura').toBe(1)
  expect(segunda.url).toBe('https://github.com/o/r/pull/77')
  expect(segunda.reaproveitada).toBe(true)
})

test('COMPORTAMENTO gh que falha nao registra efeito, e o erro chega ao chamador', async () => {
  const { abrirPrUmaVez } = await import('../../motor/quilombo/cartorio/pr.ts')
  let chamadas = 0
  const ghQuebrado = async (): Promise<{ err: Error; stdout: string; stderr: string }> => {
    chamadas++
    return { err: new Error('exit 1'), stdout: '', stderr: 'gh: could not create pull request\n' }
  }
  const pedido = {
    card: 'pr-falha', repoName: 'o/r', base: 'main', branch: 'b',
    titulo: 't', corpo: 'c', worktree: '/tmp', prExistente: '',
  }
  const tipo = ghQuebrado as unknown as typeof import('../../motor/quilombo/git.ts').run
  const r = await abrirPrUmaVez(pedido, tipo)
  expect(r.url).toBe('')
  expect(r.erro).toContain('could not create')
  // Falha NAO grava a chave: a operacao tem de continuar tentavel.
  await abrirPrUmaVez(pedido, tipo)
  expect(chamadas, 'efeito que nao aconteceu nao pode trancar a operacao para sempre').toBe(2)
})
