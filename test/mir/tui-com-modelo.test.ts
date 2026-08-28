import { test, expect, afterAll } from '../apoio/runner.ts'
import { TEMPO_COM_GIT_MS } from '../tempo-de-teste.ts'
import { join } from 'node:path'
import { createApp } from '../../motor/mir/tui/app.ts'
import { handle, newSession, sincronizarPergunta } from '../../motor/mir/sessao.ts'
import type { SessionState } from '../../motor/mir/sessao.ts'
import { dispatch } from '../../motor/mir/despacho.ts'
import { dispatchIOFalso } from '../fixtures/dispatch-io-falso.ts'
import { renderBoardJanela } from '../../motor/mir/render/board.ts'
import { pendencia } from '../../motor/mir/responder.ts'
import { renderPergunta } from '../../motor/mir/render/clarify.ts'
import { providerNameFor } from '../../motor/tmd/registro.ts'
import { runGatedStep } from '../../motor/cic/passo-com-gate.ts'
import type { ExecuteDeps } from '../../motor/osw/executar.ts'
import type { ImplementResult } from '../../motor/cdl/index.ts'
import { createCard, readCard, patchCard, allCards, repoPath } from '../../motor/cdl/store.ts'
import { handleExecute } from '../../motor/osw/executar.ts'
import { pending } from '../../motor/osw/mtr/estado-da-fila.ts'
import {
  BASE, REPO_NOME, limparAmbiente, usarArquivoDeIa, novoDirDeCassete,
  agentResultDe, instalarHarnessDoCassete, lerCassete, fakeTerminal,
} from '../fixtures/motor-cassete-falso.ts'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

if (!process.env.HICODE_CARDS_DIR) throw new Error('HICODE_CARDS_DIR nao foi isolado pela fixture — abortando para nao escrever em cards/ de verdade')

afterAll(() => limparAmbiente())

test('TUI cria a tarefa, o motor executa com o harness do cassete, e o card chega a URL com custo e tokens do modelo gravados', async () => {
  usarArquivoDeIa('ia-principal')
  const dirDoCassete = novoDirDeCassete('principal')
  let chamadasDeImplement = 0
  const claude = instalarHarnessDoCassete('claude', (req) => {
    if (req.mode === 'readonly') return agentResultDe('{"questions":[]}', 0, 0, 0)
    chamadasDeImplement++
    return agentResultDe('rodape ganhou o contador de itens', 0.1234, 100, 50)
  }, dirDoCassete)
  try {
    const io = dispatchIOFalso({ daemonOnline: () => true })
    let estado: SessionState = newSession(REPO_NOME)
    const r = handle('/new-task adicionar contador de itens no rodape do painel', estado)
    const resultado = await dispatch(r.effect, r.state, io)
    estado = resultado.state
    const id = estado.seguindo
    expect(id).toBeTruthy()
    expect(readCard(id)?.fm.status).toBe('EXECUTING')
    patchCard(id, { worktree: join(BASE, 'wt-principal') })

    const naFila = pending()
    expect(naFila.some(j => j.kind === 'execute' && j.id === id)).toBe(true)

    await handleExecute(id)

    expect(chamadasDeImplement).toBe(1)
    const card = readCard(id)
    expect(card?.fm.status).toBe('URL')
    expect(card?.fm.verify).toBe('sem-url')
    expect(card?.fm.cost_usd).toBe('0.1234')
    expect(card?.fm.tokens_total).toBe('150')

    const gravado = lerCassete(claude.caminhoDoCassete)
    expect(gravado.entradas.length).toBeGreaterThan(0)
  } finally {
    claude.restaurar()
  }
}, TEMPO_COM_GIT_MS)

test('CLARIFY: a pergunta do modelo aparece para a TUI mostrar, e a resposta humana destrava a execucao ate o fim', async () => {
  usarArquivoDeIa('ia-clarify')
  const dirDoCassete = novoDirDeCassete('clarify')
  let chamadasDeImplement = 0
  const claude = instalarHarnessDoCassete('claude', (req) => {
    if (req.mode === 'readonly') {
      return agentResultDe('{"questions":[{"q":"Qual cor usar no botao novo?","options":["azul","verde"],"recommended":"azul"}]}', 0.02, 5, 5)
    }
    chamadasDeImplement++
    return agentResultDe('botao adicionado na cor escolhida', 0.05, 20, 15)
  }, dirDoCassete)
  try {
    const io = dispatchIOFalso({ daemonOnline: () => true })
    let estado: SessionState = newSession(REPO_NOME)
    const r1 = handle('/new-task adicionar campo de telefone no formulario de contato', estado)
    const res1 = await dispatch(r1.effect, r1.state, io)
    estado = res1.state
    const id = estado.seguindo
    expect(id).toBeTruthy()
    patchCard(id, { worktree: join(BASE, 'wt-clarify') })

    await handleExecute(id)
    expect(readCard(id)?.fm.status).toBe('CLARIFY')

    const pend = pendencia(id)
    if (!pend) throw new Error('esperava pendencia de clarify e nao havia nenhuma')
    expect(pend.origem).toBe('clarify')
    expect(pend.atual.q).toContain('Qual cor usar')

    const linhas = renderPergunta(pend, { color: false })
    expect(linhas.join('\n')).toContain('Qual cor usar no botao novo')

    estado = sincronizarPergunta(estado, `${id}:${pend.atual.q}`)
    expect(estado.perguntando).toBe(id)

    const r2 = handle('azul', estado)
    const res2 = await dispatch(r2.effect, r2.state, io)
    estado = res2.state
    expect(estado.perguntando).toBe('')
    expect(estado.seguindo).toBe(id)
    expect(readCard(id)?.fm.status).toBe('EXECUTING')
    expect(readCard(id)?.fm.clarified).toBe('true')

    await handleExecute(id)
    expect(chamadasDeImplement).toBe(1)
    expect(readCard(id)?.fm.status).toBe('URL')
  } finally {
    claude.restaurar()
  }
}, TEMPO_COM_GIT_MS)

test('GATE: o crivo reprova, passo-com-gate repete o passo, e o prompt da segunda tentativa contem a reprovacao SEM substituir a instrucao original', async () => {
  usarArquivoDeIa('ia-gate')
  const dirDoCassete = novoDirDeCassete('gate')
  let chamadasDeGate = 0
  const promptsDoPasso: string[] = []
  const claude = instalarHarnessDoCassete('claude', (req) => {
    if (req.mode === 'readonly') {
      chamadasDeGate++
      const texto = chamadasDeGate === 1
        ? '{"verdict":"BLOCKED","reason":"faltou tratar entrada vazia","criterio":"C1","questions":[]}'
        : '{"verdict":"APPROVED","reason":"corrigido","criterio":"","questions":[]}'
      return agentResultDe(texto, 0.02, 5, 5)
    }
    promptsDoPasso.push(req.prompt)
    return agentResultDe('passo aplicado', 0.03, 8, 8)
  }, dirDoCassete)
  try {
    const wt = join(BASE, 'wt-gate')
    const id = createCard({
      title: 'ajustar validacao do formulario',
      status: 'EXECUTING',
      repo: REPO_NOME,
      surface: 'none',
      clarified: 'true',
      worktree: wt,
    }, '## Objetivo\najustar validacao de entrada vazia\n')

    const implementQueCommitaAjuste: ExecuteDeps = {
      implement: (_card, wtDoCard): Promise<ImplementResult> => {
        writeFileSync(join(wtDoCard, 'validacao.txt'), 'validar entrada\n')
        execFileSync('git', ['add', '-A'], { cwd: wtDoCard })
        execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'trabalho do agente'], { cwd: wtDoCard })
        return Promise.resolve({
          ok: true,
          resultText: 'validacao adicionada',
          fullText: 'validacao adicionada',
          cost: '0.0500',
          usage: { tokens_in: 10, tokens_out: 10, tokens_cache_create: 0, tokens_cache_read: 0 },
        })
      },
      verifyVisual: (): Promise<never> => Promise.reject(new Error('nao deveria chamar verifyVisual')),
    }
    await handleExecute(id, implementQueCommitaAjuste)
    expect(readCard(id)?.fm.status).toBe('URL')

    const target = repoPath(REPO_NOME)
    const resultado = await runGatedStep(id, wt, 'main', target, 'rufus', 'trate o caso de entrada vazia', 'ajustar validacao de entrada vazia', 'Seguranca')

    expect(resultado.ok).toBe(true)
    expect(chamadasDeGate).toBe(2)
    expect(promptsDoPasso.length).toBe(2)
    expect(promptsDoPasso[0]).not.toContain('O revisor CRIVO reprovou')

    const original = 'trate o caso de entrada vazia'
    const segundoPrompt = promptsDoPasso[1] ?? ''
    const indiceOriginal = segundoPrompt.indexOf(original)
    const indiceReprovacao = segundoPrompt.indexOf('O revisor CRIVO reprovou a tentativa 1: faltou tratar entrada vazia')
    expect(indiceOriginal).toBeGreaterThanOrEqual(0)
    expect(indiceReprovacao).toBeGreaterThan(indiceOriginal)
  } finally {
    claude.restaurar()
  }
}, TEMPO_COM_GIT_MS)

test('a troca de IA pela TUI (/ia) reflete no harness que o motor de fato chama, nos dois sentidos', async () => {
  usarArquivoDeIa('ia-switch')
  const dirDoCassete = novoDirDeCassete('ia-switch')
  let chamadasClaude = 0
  let chamadasCodex = 0
  const claude = instalarHarnessDoCassete('claude', (req) => {
    if (req.mode === 'readonly') return agentResultDe('{"questions":[]}', 0, 0, 0)
    chamadasClaude++
    return agentResultDe('claude implementou', 0.10, 10, 10)
  }, dirDoCassete)
  const codex = instalarHarnessDoCassete('codex', (req) => {
    if (req.mode === 'readonly') return agentResultDe('{"questions":[]}', 0, 0, 0)
    chamadasCodex++
    return agentResultDe('codex implementou', 0.20, 20, 20)
  }, dirDoCassete)
  try {
    const io = dispatchIOFalso({ daemonOnline: () => true })
    let estado: SessionState = newSession(REPO_NOME)

    const rIa = handle('/ia codex', estado)
    const resIa = await dispatch(rIa.effect, rIa.state, io)
    estado = resIa.state
    expect(providerNameFor('implement')).toBe('codex')

    const r1 = handle('/new-task revisar o texto do rodape institucional', estado)
    const res1 = await dispatch(r1.effect, r1.state, io)
    estado = res1.state
    const id1 = estado.seguindo
    patchCard(id1, { worktree: join(BASE, 'wt-ia-switch-1') })
    await handleExecute(id1)
    expect(chamadasCodex).toBe(1)
    expect(chamadasClaude).toBe(0)
    expect(readCard(id1)?.fm.status).toBe('URL')

    const rIaVolta = handle('/ia claude', estado)
    const resIaVolta = await dispatch(rIaVolta.effect, rIaVolta.state, io)
    estado = resIaVolta.state
    expect(providerNameFor('implement')).toBe('claude')

    const r2 = handle('/new-task revisar o texto do cabecalho institucional', estado)
    const res2 = await dispatch(r2.effect, r2.state, io)
    estado = res2.state
    const id2 = estado.seguindo
    patchCard(id2, { worktree: join(BASE, 'wt-ia-switch-2') })
    await handleExecute(id2)
    expect(chamadasClaude).toBe(1)
    expect(chamadasCodex).toBe(1)
    expect(readCard(id2)?.fm.status).toBe('URL')
  } finally {
    claude.restaurar()
    codex.restaurar()
  }
}, TEMPO_COM_GIT_MS)

test('a TUI pinta o quadro sem lancar excecao com o card em EXECUTING e depois em CLARIFY', async () => {
  const io = dispatchIOFalso({ daemonOnline: () => true })
  let estado: SessionState = newSession(REPO_NOME)
  const r = handle('/new-task revisar o rodape da pagina de contato', estado)
  const resultado = await dispatch(r.effect, r.state, io)
  estado = resultado.state
  const id = estado.seguindo
  expect(readCard(id)?.fm.status).toBe('EXECUTING')

  const term = fakeTerminal(24, 80)
  const app = createApp(term, {
    header: () => `hii · ${estado.repo}`,
    corpo: (ctx) => renderBoardJanela(allCards(), { repo: estado.repo, now: Date.now() }, ctx.altura),
    dica: () => '/help',
    prompt: () => '› ',
    rodape: () => ['rodape'],
    onLine: () => {},
    onComplete: () => [],
    onInterrupt: () => true,
    intervalMs: 10_000,
  })
  const rodando = app.run()

  expect(() => { for (const k of ['\x1b[A', '\x1b[B', '\t', '\x0c']) term.tecla(k) }).not.toThrow()
  const pintadoEmExecuting = term.saida.length
  expect(pintadoEmExecuting).toBeGreaterThan(0)

  patchCard(id, { status: 'CLARIFY' })
  expect(() => { for (const k of ['\x1b[A', '\x1b[B', '\r']) term.tecla(k) }).not.toThrow()
  expect(term.saida.length).toBeGreaterThan(pintadoEmExecuting)

  app.encerrar()
  await rodando
}, TEMPO_COM_GIT_MS)
