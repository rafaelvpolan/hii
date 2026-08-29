import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { envolverComCassete, chaveDoPedido, type ModoDoCassete } from '../apoio/cassete.ts'
import {
  abrirRodadaCara,
  gastaModelo,
  trilhaCaraDeveRodar,
  CustoDaChamadaDesconhecido,
  TetoDeGastoEstourado,
  ENV_TRILHA_CARA_HABILITADA,
  ENV_TETO_DE_GASTO_USD,
} from '../apoio/e2e.ts'
import { ClaudeProvider, CLAUDE_CAPACIDADES } from '../../motor/tmd/harness/claude.ts'
import { SEM_PLANO } from '../../motor/tmd/tipos.ts'
import type { AgentRequest, AgentResult, Harness } from '../../motor/tmd/tipos.ts'
import { emptyUsage } from '../../motor/tmd/uso.ts'

const DIRETORIOS_TEMPORARIOS: string[] = []

function diretorioTemporario(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hii-cassete-teste-'))
  DIRETORIOS_TEMPORARIOS.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of DIRETORIOS_TEMPORARIOS) rmSync(dir, { recursive: true, force: true })
})

function harnessFalso(nome: string, executar: (req: AgentRequest) => AgentResult | Promise<AgentResult>): Harness {
  return {
    name: nome,
    supportsAgents: false,
    supportsVision: false,
    agentic: false,
    modos: { modos: [], padrao: '' },
    cor: { r: 0, g: 0, b: 0 },
    binario: `${nome}-binario-falso`,
    exigeCliNoPath: false,
    comandoDeLogin: [],
    temLeitorDePlano: false,
    rodaLocal: true,
    capabilities: () => ({ restrictsTools: false, isolatesReadonly: false, acceptsEffort: false, reportsCostUsd: true, reportsTokens: true, mcp: false }),
    healthCheck: async () => true,
    sinaisDeFalha: () => ({ terminal: [], quota: [], transient: [] }),
    comoObterQuandoAusente: () => '',
    autenticado: () => true,
    plano: () => SEM_PLANO,
    modelosDisponiveis: () => [],
    prontoParaUso: () => true,
    modeloPadraoPara: () => undefined,
    run: async req => executar(req),
  }
}

function pedidoBase(sobrescritas: Partial<AgentRequest> = {}): AgentRequest {
  return {
    prompt: 'faca algo util',
    cwd: '/tmp/hii-cassete-teste/worktree-padrao',
    dirs: ['/tmp/hii-cassete-teste/worktree-padrao'],
    mode: 'edit',
    useAgents: false,
    timeoutMs: 5000,
    ...sobrescritas,
  }
}

function resultadoOk(sobrescritas: Partial<AgentResult> = {}): AgentResult {
  return {
    ok: true,
    failed: false,
    timedOut: false,
    isError: false,
    detail: '',
    text: '',
    cost: 0,
    costMeasured: true,
    usage: emptyUsage(),
    ...sobrescritas,
  }
}

function capturarErro(executar: () => void): Error {
  try {
    executar()
  } catch (e) {
    return e as Error
  }
  throw new Error('esperava que a funcao lancasse, e ela nao lancou')
}

test('envolverComCassete preserva o contrato de um harness de CLASSE (ClaudeProvider) — metodos de prototipo continuam acessiveis atraves do proxy', () => {
  const real = new ClaudeProvider()
  const envolvido = envolverComCassete(real, { nome: 'contrato/claude', dir: diretorioTemporario() })
  expect(envolvido.name).toBe('claude')
  expect(envolvido.binario).toBe('claude')
  // Comparar so com CLAUDE_CAPACIDADES prova que o proxy nao trocou o objeto, mas
  // passaria igual se a constante fosse esvaziada na origem. O par abaixo fecha os
  // dois lados: o proxy encaminha, E o que ele encaminha tem conteudo de verdade.
  expect(envolvido.capabilities()).toEqual(CLAUDE_CAPACIDADES)
  expect(Object.keys(envolvido.capabilities()).length).toBe(6)
  expect(envolvido.capabilities().reportsCostUsd).toBe(true)
  expect(envolvido.sinaisDeFalha().quota.length).toBeGreaterThan(0)
  expect(typeof envolvido.run).toBe('function')
})

test('gravar em modo gravar-se-faltar e depois reproduzir devolve o MESMO AgentResult, sem chamar o harness real de novo', async () => {
  const dir = diretorioTemporario()
  let quantasChamadasReais = 0
  const real = harnessFalso('falso', () => {
    quantasChamadasReais++
    return resultadoOk({ text: 'resposta original', cost: 0.1234, usage: { tokens_in: 10, tokens_out: 20, tokens_cache_create: 0, tokens_cache_read: 0 } })
  })
  const pedido = pedidoBase()

  const gravando = envolverComCassete(real, { nome: 'grava-e-reproduz', dir, modo: 'gravar-se-faltar' })
  const resultadoGravado = await gravando.run(pedido)
  expect(quantasChamadasReais).toBe(1)

  const reproduzindo = envolverComCassete(real, { nome: 'grava-e-reproduz', dir, modo: 'reproduzir' })
  const resultadoReproduzido = await reproduzindo.run(pedido)

  expect(quantasChamadasReais).toBe(1)
  expect(resultadoReproduzido).toEqual(resultadoGravado)
})

test('chaveDoPedido normaliza cwd e dirs absolutos — dois pedidos so diferindo no caminho do worktree produzem a MESMA chave', () => {
  const chaveA = chaveDoPedido(pedidoBase({ cwd: '/tmp/worktree-A', dirs: ['/tmp/worktree-A'] }))
  const chaveB = chaveDoPedido(pedidoBase({ cwd: '/var/outro/lugar/worktree-B', dirs: ['/var/outro/lugar/worktree-B'] }))
  expect(chaveA).toEqual(chaveB)
})

test('chaveDoPedido NAO normaliza o prompt — pedidos com prompt diferente produzem chaves diferentes', () => {
  const chaveA = chaveDoPedido(pedidoBase({ prompt: 'faca a tarefa A' }))
  const chaveB = chaveDoPedido(pedidoBase({ prompt: 'faca a tarefa B' }))
  expect(chaveA).not.toEqual(chaveB)
})

test('chaveDoPedido substitui caminho aninhado dentro do prompt do maior para o menor, sem corromper o caminho mais longo', () => {
  const chave = chaveDoPedido(pedidoBase({
    cwd: '/tmp/wt',
    dirs: ['/tmp/wt', '/tmp/wt/pacote-x'],
    prompt: 'edite o arquivo em /tmp/wt/pacote-x/main.ts, dentro do worktree /tmp/wt',
  }))
  expect(chave.prompt).toBe('edite o arquivo em <DIR:1>/main.ts, dentro do worktree <CWD>')
})

test('gravado com um worktree, o cassete reproduz para um pedido cujo worktree e so o caminho absoluto diferente', async () => {
  const dir = diretorioTemporario()
  const real = harnessFalso('falso', () => resultadoOk({ text: 'ok-worktree' }))
  const gravando = envolverComCassete(real, { nome: 'normaliza-worktree', dir, modo: 'gravar-se-faltar' })
  await gravando.run(pedidoBase({ cwd: '/tmp/worktree-A', dirs: ['/tmp/worktree-A'] }))

  const reproduzindo = envolverComCassete(real, { nome: 'normaliza-worktree', dir, modo: 'reproduzir' })
  const resultado = await reproduzindo.run(pedidoBase({
    cwd: '/var/outro/lugar/completamente/diferente/worktree-B',
    dirs: ['/var/outro/lugar/completamente/diferente/worktree-B'],
  }))

  expect(resultado.text).toBe('ok-worktree')
})

test('gravado com um prompt, o mesmo worktree com prompt DIFERENTE nao acha o cassete', async () => {
  const dir = diretorioTemporario()
  const real = harnessFalso('falso', () => resultadoOk({ text: 'ok-prompt' }))
  const gravando = envolverComCassete(real, { nome: 'prompt-diferente', dir, modo: 'gravar-se-faltar' })
  await gravando.run(pedidoBase({ prompt: 'faca a tarefa A' }))

  const reproduzindo = envolverComCassete(real, { nome: 'prompt-diferente', dir, modo: 'reproduzir' })
  await expect(reproduzindo.run(pedidoBase({ prompt: 'faca a tarefa B' }))).rejects.toThrow(/cassete/i)
})

test('modo reproduzir FALHA quando falta cassete, em vez de passar em silencio, e nunca chama o harness real', async () => {
  const dir = diretorioTemporario()
  let chamouOReal = false
  const real = harnessFalso('falso', () => {
    chamouOReal = true
    return resultadoOk({ text: 'nunca deveria acontecer' })
  })
  const harness = envolverComCassete(real, { nome: 'nao-existe', dir, modo: 'reproduzir' })

  await expect(harness.run(pedidoBase())).rejects.toThrow(/cassete/i)
  expect(chamouOReal).toBe(false)
})

test('o modo vem do ambiente (HICODE_CASSETE_MODO) quando opcoes.modo nao e informado', async () => {
  const dir = diretorioTemporario()
  const real = harnessFalso('falso', () => resultadoOk({ text: 'via-ambiente' }))
  const envolvido = envolverComCassete(real, { nome: 'modo-por-ambiente', dir })

  process.env.HICODE_CASSETE_MODO = 'gravar-se-faltar' satisfies ModoDoCassete
  try {
    await envolvido.run(pedidoBase())
  } finally {
    delete process.env.HICODE_CASSETE_MODO
  }

  const reproduzindo = envolverComCassete(real, { nome: 'modo-por-ambiente', dir, modo: 'reproduzir' })
  const resultado = await reproduzindo.run(pedidoBase())
  expect(resultado.text).toBe('via-ambiente')
})

test('modo regravar sempre chama o harness real e substitui a gravacao anterior da MESMA chave', async () => {
  const dir = diretorioTemporario()
  let quantasChamadasReais = 0
  const real = harnessFalso('falso', () => {
    quantasChamadasReais++
    return resultadoOk({ text: `versao ${quantasChamadasReais}` })
  })
  const pedido = pedidoBase()

  const primeiraGravacao = envolverComCassete(real, { nome: 'regravar', dir, modo: 'gravar-se-faltar' })
  const resultado1 = await primeiraGravacao.run(pedido)
  expect(resultado1.text).toBe('versao 1')
  expect(quantasChamadasReais).toBe(1)

  const regravando = envolverComCassete(real, { nome: 'regravar', dir, modo: 'regravar' })
  const resultado2 = await regravando.run(pedido)
  expect(resultado2.text).toBe('versao 2')
  expect(quantasChamadasReais).toBe(2)

  const reproduzindo = envolverComCassete(real, { nome: 'regravar', dir, modo: 'reproduzir' })
  const resultado3 = await reproduzindo.run(pedido)
  expect(resultado3.text).toBe('versao 2')
  expect(quantasChamadasReais).toBe(2)
})

// O filtro do modo regravar rodava a CADA chamada, entao a segunda apagava a
// primeira e o cassete terminava com uma entrada so — a sequencia multi-chamada
// morria em silencio no unico modo que existe para refaze-la.
test('REGRESSAO regravar preserva a SEQUENCIA: tres chamadas iguais gravam tres entradas, nao uma', async () => {
  const dir = diretorioTemporario()
  let quantasChamadasReais = 0
  const real = harnessFalso('falso', () => {
    quantasChamadasReais++
    return resultadoOk({ text: `versao ${quantasChamadasReais}` })
  })
  const pedido = pedidoBase()

  const regravando = envolverComCassete(real, { nome: 'regravar-sequencia', dir, modo: 'regravar' })
  expect((await regravando.run(pedido)).text).toBe('versao 1')
  expect((await regravando.run(pedido)).text).toBe('versao 2')
  expect((await regravando.run(pedido)).text).toBe('versao 3')

  // Se as tres entradas nao tiverem sido gravadas, a terceira reproducao estoura
  // por cassete ausente — que e exatamente como o defeito se manifestava.
  const reproduzindo = envolverComCassete(real, { nome: 'regravar-sequencia', dir, modo: 'reproduzir' })
  expect((await reproduzindo.run(pedido)).text).toBe('versao 1')
  expect((await reproduzindo.run(pedido)).text).toBe('versao 2')
  expect((await reproduzindo.run(pedido)).text).toBe('versao 3')
  expect(quantasChamadasReais, 'a reproducao nao podia ter chamado o harness real de novo').toBe(3)
})

test('chamadas repetidas com a mesma chave no modo reproduzir sao servidas em ordem de gravacao', async () => {
  const dir = diretorioTemporario()
  let quantasChamadasReais = 0
  const real = harnessFalso('falso', () => {
    quantasChamadasReais++
    return resultadoOk({ text: `tentativa ${quantasChamadasReais}` })
  })
  const pedido = pedidoBase()

  const gravando = envolverComCassete(real, { nome: 'sequencia', dir, modo: 'gravar-se-faltar' })
  await gravando.run(pedido)
  await gravando.run(pedido)

  const reproduzindo = envolverComCassete(real, { nome: 'sequencia', dir, modo: 'reproduzir' })
  const primeira = await reproduzindo.run(pedido)
  const segunda = await reproduzindo.run(pedido)

  expect(primeira.text).toBe('tentativa 1')
  expect(segunda.text).toBe('tentativa 2')
})

test('a trilha cara nao roda por padrao, e gastaModelo devolve false sem variavel de ambiente nenhuma', () => {
  delete process.env[ENV_TRILHA_CARA_HABILITADA]
  delete process.env[ENV_TETO_DE_GASTO_USD]
  expect(trilhaCaraDeveRodar()).toBe(false)
  expect(gastaModelo('teste qualquer')).toBe(false)
})

test('habilitar a trilha cara sem configurar teto continua recusando rodar', () => {
  process.env[ENV_TRILHA_CARA_HABILITADA] = '1'
  delete process.env[ENV_TETO_DE_GASTO_USD]
  try {
    expect(trilhaCaraDeveRodar()).toBe(false)
    expect(gastaModelo('teste habilitado sem teto')).toBe(false)
  } finally {
    delete process.env[ENV_TRILHA_CARA_HABILITADA]
  }
})

test('habilitada E com teto configurado, a trilha cara roda', () => {
  process.env[ENV_TRILHA_CARA_HABILITADA] = '1'
  process.env[ENV_TETO_DE_GASTO_USD] = '5'
  try {
    expect(trilhaCaraDeveRodar()).toBe(true)
    expect(gastaModelo('teste habilitado com teto')).toBe(true)
  } finally {
    delete process.env[ENV_TRILHA_CARA_HABILITADA]
    delete process.env[ENV_TETO_DE_GASTO_USD]
  }
})

test('abrirRodadaCara recusa comecar sem teto configurado', () => {
  delete process.env[ENV_TETO_DE_GASTO_USD]
  expect(() => abrirRodadaCara()).toThrow(/teto/i)
})

// codex e kimi espalham COST_UNKNOWN em toda resposta e ja declaram
// reportsCostUsd:false. Sem guarda previa, a rodada cara so descobria isso
// DEPOIS de pagar a primeira chamada — o teto existia e nao segurava nada.
test('REGRESSAO a rodada cara recusa de graca um provedor que declara reportsCostUsd:false, antes de gastar', async () => {
  const { exigirProvedorMensuravel, ProvedorNaoMensuravel } = await import('../apoio/e2e.ts')
  const { CodexProvider } = await import('../../motor/tmd/harness/codex.ts')
  const codex = new CodexProvider()
  expect(codex.capabilities().reportsCostUsd, 'se o codex passar a reportar custo, esta guarda precisa ser revisitada').toBe(false)
  const erro = capturarErro(() => exigirProvedorMensuravel(codex))
  expect(erro).toBeInstanceOf(ProvedorNaoMensuravel)
  expect(erro.message).toContain('reportsCostUsd:false')
  expect(erro.message).toContain('codex')
})

test('a rodada cara aceita provedor que declara reportsCostUsd:true', async () => {
  const { exigirProvedorMensuravel } = await import('../apoio/e2e.ts')
  const claude = new ClaudeProvider()
  expect(claude.capabilities().reportsCostUsd).toBe(true)
  exigirProvedorMensuravel(claude)
})

test('registrarChamada com custo nao medido recusa continuar, nunca assume gasto zero', () => {
  process.env[ENV_TETO_DE_GASTO_USD] = '10'
  try {
    const rodada = abrirRodadaCara()
    expect(() => rodada.registrarChamada(resultadoOk({ costMeasured: false }))).toThrow(CustoDaChamadaDesconhecido)
    expect(rodada.gastoAcumuladoUsd).toBe(0)
  } finally {
    delete process.env[ENV_TETO_DE_GASTO_USD]
  }
})

test('o teto de gasto aborta a rodada cara quando o acumulado estoura, preservando a evidencia das duas chamadas', () => {
  process.env[ENV_TETO_DE_GASTO_USD] = '1'
  try {
    const rodada = abrirRodadaCara()
    rodada.registrarChamada(resultadoOk({ cost: 0.6 }), { papel: 'implement' })
    expect(rodada.gastoAcumuladoUsd).toBeCloseTo(0.6, 4)
    expect(() => rodada.registrarChamada(resultadoOk({ cost: 0.6 }), { papel: 'verify' })).toThrow(TetoDeGastoEstourado)
    expect(rodada.evidenciasDaRodada().length).toBe(2)
  } finally {
    delete process.env[ENV_TETO_DE_GASTO_USD]
  }
})

test('TetoDeGastoEstourado carrega o gasto acumulado e o teto exatos, para quem for exibir a falha', () => {
  process.env[ENV_TETO_DE_GASTO_USD] = '1'
  try {
    const rodada = abrirRodadaCara()
    rodada.registrarChamada(resultadoOk({ cost: 0.9 }))
    const erro = capturarErro(() => rodada.registrarChamada(resultadoOk({ cost: 0.5 })))
    expect(erro).toBeInstanceOf(TetoDeGastoEstourado)
    expect((erro as TetoDeGastoEstourado).tetoUsd).toBe(1)
    expect((erro as TetoDeGastoEstourado).gastoAcumuladoUsd).toBeCloseTo(1.4, 4)
  } finally {
    delete process.env[ENV_TETO_DE_GASTO_USD]
  }
})
