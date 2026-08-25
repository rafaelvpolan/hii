import { test, expect, beforeEach, lerArquivo } from '../apoio/runner.ts'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hicode-ia-'))
  process.env.HICODE_IA_FILE = join(dir, 'ia.json')
  for (const v of ['HICODE_EFFORT', 'HICODE_IMPLEMENT_PROVIDER', 'HICODE_GATE_PROVIDER', 'HICODE_AI_PROVIDER']) {
    delete process.env[v]
  }
})

test('a troca vale sem reiniciar: a leitura seguinte ja ve o novo valor', async () => {
  const { aplicar } = await import('../../motor/mir/escolher-ia.ts')
  const { providerNameFor, modelFor } = await import('../../motor/tmd/registro.ts')
  aplicar({ papeis: ['gate'], provider: 'codex', model: 'gpt-5.5' })
  expect(providerNameFor('gate')).toBe('codex')
  expect(modelFor('gate')).toBe('gpt-5.5')
})

test('preferencia em arquivo vence a env', async () => {
  process.env.HICODE_GATE_PROVIDER = 'ollama'
  const { aplicar } = await import('../../motor/mir/escolher-ia.ts')
  const { providerNameFor } = await import('../../motor/tmd/registro.ts')
  aplicar({ papeis: ['gate'], provider: 'codex' })
  expect(providerNameFor('gate')).toBe('codex')
  delete process.env.HICODE_GATE_PROVIDER
})

test('padrao limpa a preferencia e a env volta a valer', async () => {
  process.env.HICODE_GATE_PROVIDER = 'ollama'
  const { aplicar, limpar } = await import('../../motor/mir/escolher-ia.ts')
  const { providerNameFor } = await import('../../motor/tmd/registro.ts')
  aplicar({ papeis: ['gate'], provider: 'codex' })
  limpar(['gate'])
  expect(providerNameFor('gate')).toBe('ollama')
  delete process.env.HICODE_GATE_PROVIDER
})

test('interpretar entende papel, provedor, modelo e esforco em qualquer ordem', async () => {
  const { interpretar } = await import('../../motor/mir/escolher-ia.ts')
  expect(interpretar(['gate', 'claude', 'opus']).ajuste).toMatchObject({ papeis: ['gate'], provider: 'claude', model: 'opus' })
  expect(interpretar(['high', 'codex']).ajuste).toMatchObject({ provider: 'codex', effort: 'high' })
  expect(interpretar(['modelo=gpt-5.5']).ajuste).toMatchObject({ model: 'gpt-5.5' })
})

test('sem papel, o ajuste vale para todos', async () => {
  const { interpretar } = await import('../../motor/mir/escolher-ia.ts')
  const { agentRoles } = await import('../../motor/tmd/registro.ts')
  expect(interpretar(['claude']).ajuste?.papeis).toEqual(agentRoles())
})

test('argumento vazio ou sem sentido nao muda nada em silencio', async () => {
  const { interpretar } = await import('../../motor/mir/escolher-ia.ts')
  expect(interpretar([]).ajuste).toBeUndefined()
  expect(interpretar(['gate']).erro).toBeTruthy()
})

test('esforco escolhido chega ao pedido do provedor', async () => {
  const { aplicar } = await import('../../motor/mir/escolher-ia.ts')
  const { effortFor } = await import('../../motor/tmd/registro.ts')
  aplicar({ papeis: ['implement'], effort: 'xhigh' })
  expect(effortFor('implement')).toBe('xhigh')
})

test('esforco do card vence a preferencia global', async () => {
  const { aplicar } = await import('../../motor/mir/escolher-ia.ts')
  const { effortFor } = await import('../../motor/tmd/registro.ts')
  aplicar({ papeis: ['implement'], effort: 'low' })
  expect(effortFor('implement', 'max')).toBe('max')
})

test('esforco invalido e ignorado em vez de virar argumento de CLI', async () => {
  const { effortFor } = await import('../../motor/tmd/registro.ts')
  expect(effortFor('implement', 'altissimo')).toBeUndefined()
})

test('REGRESSAO esforco vira argumento real do CLI nos DOIS caminhos, nao so enfeite no rodape', async () => {
  const { claudeArgv, FORMATO_JSON, FORMATO_STREAM } = await import('../../motor/tmd/harness/claude-argv.ts')
  const req = {
    prompt: 'x', cwd: '/tmp', dirs: [], mode: 'edit' as const, useAgents: false,
    timeoutMs: 1, effort: 'high', agentsJson: '{"rufus":{"description":"d","prompt":"p"}}',
  }
  for (const formato of [FORMATO_JSON, FORMATO_STREAM]) {
    const argv = claudeArgv(req, formato)
    expect(argv).toContain('--effort')
    expect(argv[argv.indexOf('--effort') + 1]).toBe('high')
    expect(argv).toContain('--agents')
  }
  // Isto era um grep em codex.ts, e um COMENTARIO citando
  // `model_reasoning_effort` bastava para o invariante passar com o esforco nao
  // chegando ao argv. Agora monta o argv de verdade e olha o que sai.
  const { argv: codexArgv } = await import('../../motor/tmd/harness/codex.ts')
  const doCodex = codexArgv({ ...req, effort: 'high' }, '/wt')
  const comEsforco = doCodex.filter(a => a.includes('model_reasoning_effort'))
  expect(comEsforco.length, 'o esforco tem de sair no argv do codex, nao so num comentario').toBeGreaterThan(0)
  expect(comEsforco.join(' ')).toContain('high')
  const semEsforco = codexArgv({ ...req, effort: '' }, '/wt')
  expect(semEsforco.some(a => a.includes('model_reasoning_effort')), 'sem esforco pedido, nao inventa flag').toBe(false)
})

test('REGRESSAO um construtor de argv so — o caminho de live-log e o de json nao podem divergir', async () => {
  const { claudeArgv, FORMATO_JSON, FORMATO_STREAM } = await import('../../motor/tmd/harness/claude-argv.ts')
  const req = {
    prompt: 'x', cwd: '/tmp', dirs: ['/wt'], mode: 'edit' as const, useAgents: true,
    timeoutMs: 1, model: 'opus', effort: 'high', agentsJson: '{"rufus":{}}', extraTools: ['mcp__omc'],
  }
  const semFormato = (a: string[]): string[] => a.filter(x => x !== 'json' && x !== 'stream-json' && x !== '--verbose' && x !== '--output-format')
  expect(semFormato(claudeArgv(req, FORMATO_JSON))).toEqual(semFormato(claudeArgv(req, FORMATO_STREAM)))
})

test('o pedido do provedor carrega o campo de esforco', async () => {
  const tipos = await lerArquivo('motor/tmd/tipos.ts')
  expect(tipos).toContain('effort?: string')
})

test('/ia mostra quais papeis usam cada provedor', async () => {
  const { aplicar } = await import('../../motor/mir/escolher-ia.ts')
  const { provedoresDisponiveis } = await import('../../motor/tmd/disponibilidade.ts')
  aplicar({ papeis: ['gate'], provider: 'codex' })
  const codex = provedoresDisponiveis().find(p => p.nome === 'codex')
  expect(codex?.papeis).toContain('gate')
})

test('a listagem do /ia nao esconde provedor sem papel', async () => {
  const { estadoDaIa } = await import('../../motor/mir/escolher-ia.ts')
  const { providerNames } = await import('../../motor/tmd/registro.ts')
  const texto = estadoDaIa().join('\n')
  for (const n of providerNames()) expect(texto, n).toContain(n)
})

test('REGRESSAO o rodape nao pode inventar "medium" quando nada esta configurado', async () => {
  const { effortFor } = await import('../../motor/tmd/registro.ts')
  expect(effortFor('implement')).toBeUndefined()
})

test('o rodape reflete o esforco escolhido, e volta ao padrao quando limpo', async () => {
  const { aplicar, limpar } = await import('../../motor/mir/escolher-ia.ts')
  const { effortFor } = await import('../../motor/tmd/registro.ts')
  aplicar({ papeis: ['implement'], effort: 'xhigh' })
  expect(effortFor('implement')).toBe('xhigh')
  limpar(['implement'])
  expect(effortFor('implement')).toBeUndefined()
})

test('o esforco do card aparece no rodape quando a tarefa esta aberta', async () => {
  const { effortFor } = await import('../../motor/tmd/registro.ts')
  expect(effortFor('implement', 'max')).toBe('max')
})

test('a env continua valendo como configuracao inicial no rodape', async () => {
  const { effortFor } = await import('../../motor/tmd/registro.ts')
  process.env.HICODE_EFFORT = 'low'
  expect(effortFor('implement')).toBe('low')
  delete process.env.HICODE_EFFORT
})

test('REGRESSAO rodape e motor leem a MESMA fonte de esforco', async () => {
  const { esforcoAtual } = await import('../../motor/mir/cli/rodape-tui.ts')
  const { effortFor } = await import('../../motor/tmd/registro.ts')
  const { newSession } = await import('../../motor/mir/sessao.ts')
  const { ESFORCO_PADRAO } = await import('../../motor/tmd/preferencias.ts')
  expect(esforcoAtual(newSession('org/app'))).toBe(effortFor('implement') ?? ESFORCO_PADRAO)
})

test('REGRESSAO o rodape nao pode chutar um esforco fixo', async () => {
  const fonte = await lerArquivo('motor/mir/cli/rodape-tui.ts')
  expect(fonte).toContain("effortFor('implement', doCard)")
  expect(fonte).not.toContain("|| 'medium'")
})

test('/model sem argumento lista os modelos da ia atual', async () => {
  const { definirModelo } = await import('../../motor/mir/escolher-ia.ts')
  const r = definirModelo([])
  expect(r.ok).toBe(false)
  expect(r.mensagem).toContain('opus')
})

test('/model define o modelo do papel atual', async () => {
  const { definirModelo } = await import('../../motor/mir/escolher-ia.ts')
  const { modelFor } = await import('../../motor/tmd/registro.ts')
  definirModelo(['opus'])
  expect(modelFor('implement')).toBe('opus')
})

test('/model <papel> <modelo> mira o papel pedido', async () => {
  const { definirModelo } = await import('../../motor/mir/escolher-ia.ts')
  const { modelFor } = await import('../../motor/tmd/registro.ts')
  definirModelo(['gate', 'sonnet'])
  expect(modelFor('gate')).toBe('sonnet')
  expect(modelFor('implement')).not.toBe('sonnet')
})

test('/model fora do catalogo funciona, mas avisa', async () => {
  const { definirModelo } = await import('../../motor/mir/escolher-ia.ts')
  const { modelFor } = await import('../../motor/tmd/registro.ts')
  const r = definirModelo(['modelo-que-eu-inventei'])
  expect(r.ok).toBe(true)
  expect(r.mensagem).toContain('fora do catalogo')
  expect(modelFor('implement')).toBe('modelo-que-eu-inventei')
})

test('/model padrao devolve o modelo do CLI', async () => {
  const { definirModelo } = await import('../../motor/mir/escolher-ia.ts')
  const { modelFor } = await import('../../motor/tmd/registro.ts')
  definirModelo(['opus'])
  definirModelo(['padrao'])
  expect(modelFor('implement')).toBeUndefined()
})

test('/effort sem argumento lista os niveis', async () => {
  const { definirEsforco } = await import('../../motor/mir/escolher-ia.ts')
  const r = definirEsforco([])
  expect(r.ok).toBe(false)
  expect(r.mensagem).toContain('xhigh')
})

test('/effort recusa nivel invalido em vez de mandar lixo para o CLI', async () => {
  const { definirEsforco } = await import('../../motor/mir/escolher-ia.ts')
  const { effortFor } = await import('../../motor/tmd/registro.ts')
  const r = definirEsforco(['altissimo'])
  expect(r.ok).toBe(false)
  expect(effortFor('implement')).toBeUndefined()
})

test('/effort padrao limpa so o esforco, preservando a ia escolhida', async () => {
  const { definirEsforco, aplicar } = await import('../../motor/mir/escolher-ia.ts')
  const { effortFor, providerNameFor } = await import('../../motor/tmd/registro.ts')
  aplicar({ papeis: ['implement'], provider: 'codex' })
  definirEsforco(['high'])
  definirEsforco(['padrao'])
  expect(effortFor('implement')).toBeUndefined()
  expect(providerNameFor('implement')).toBe('codex')
})

test('o catalogo de modelos vem de arquivo quando existe', async () => {
  const { modelosDe, origemDoCatalogo } = await import('../../motor/tmd/catalogo.ts')
  expect(origemDoCatalogo('claude')).toBe('semente')
  expect(modelosDe('claude')).toContain('opus')
})

test('modelo em uso entra no catalogo mesmo sem estar na semente', async () => {
  const { definirModelo } = await import('../../motor/mir/escolher-ia.ts')
  const { modelosDe } = await import('../../motor/tmd/catalogo.ts')
  definirModelo(['implement', 'meu-modelo-local'])
  expect(modelosDe('claude')).toContain('meu-modelo-local')
})

test('autocompletar de /ia, /model e /effort oferece as opcoes certas', async () => {
  const { complete } = await import('../../motor/mir/completar.ts')
  const { providerNames, agentRoles } = await import('../../motor/tmd/registro.ts')
  const { modelosDe } = await import('../../motor/tmd/catalogo.ts')
  const { ESFORCOS } = await import('../../motor/tmd/preferencias.ts')
  const ctx = {
    repos: [], cards: [], statuses: [],
    provedores: providerNames(), modelos: modelosDe('claude'),
    esforcos: [...ESFORCOS], papeis: agentRoles(),
  }
  expect(complete('/ia ', ctx)[0]).toContain('claude')
  expect(complete('/model ', ctx)[0]).toContain('opus')
  expect(complete('/effort ', ctx)[0]).toContain('xhigh')
  expect(complete('/effort h', ctx)[0]).toEqual(['high'])
})

test('gravar a preferencia e ATOMICO e nao deixa .tmp para tras — writeFileSync no lugar de rename truncava o ia.json', async () => {
  const { mkdtempSync, readdirSync, rmSync, existsSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const raiz = mkdtempSync(join(tmpdir(), 'hii-ia-'))
  const antes = process.env.HICODE_IA_FILE
  process.env.HICODE_IA_FILE = join(raiz, 'ia.json')
  try {
    const { aplicar } = await import('../../motor/mir/escolher-ia.ts')
    aplicar({ papeis: ['implement'], provider: 'claude' })
    expect(existsSync(join(raiz, 'ia.json'))).toBe(true)
    expect(readdirSync(raiz).filter(f => f.includes('.tmp.'))).toEqual([])
  } finally {
    if (antes === undefined) delete process.env.HICODE_IA_FILE
    else process.env.HICODE_IA_FILE = antes
    rmSync(raiz, { recursive: true, force: true })
  }
})

// `ler()` passou a LANCAR quando o ia.json esta ilegivel — porque `aplicar` faz
// read-modify-WRITE e gravar por cima apagaria a preferencia dos outros papeis. Mas
// `aplicar` e `ciclarModo` sao chamados de dentro do handler de TECLA da TUI, que
// nao tem catch: excecao ali mata o processo com o terminal em raw mode. Nenhuma
// funcao exportada deste modulo pode lancar.
test('com ia.json ILEGIVEL, nenhuma funcao exportada LANCA — a TUI nao pode morrer', async () => {
  const { writeFileSync } = await import('node:fs')
  const M = await import('../../motor/mir/escolher-ia.ts')
  writeFileSync(process.env.HICODE_IA_FILE as string, '{ isto nao e json')

  for (const [nome, chamada] of [
    ['aplicar', () => M.aplicar({ papeis: ['gate'], provider: 'codex' })],
    ['limpar', () => M.limpar(['gate'])],
    ['limparEsforco', () => M.limparEsforco(['gate'])],
    ['ciclarModo', () => M.ciclarModo('implement', 1)],
    ['definirModelo', () => M.definirModelo(['opus'])],
    ['definirEsforco', () => M.definirEsforco(['high'])],
    ['definirModoDeOperacao', () => M.definirModoDeOperacao(['plan'])],
    ['definirGauntlet', () => M.definirGauntlet(['on'])],
  ] as const) {
    expect(() => chamada(), `${nome} lancou`).not.toThrow()
    expect(chamada().ok, `${nome} nao pode dizer que deu certo`).toBe(false)
    expect(chamada().mensagem, `${nome} tem de explicar`).toContain('ILEGIVEL')
  }
  expect(() => M.estadoDaIa(), 'estadoDaIa lancou').not.toThrow()
  expect(M.estadoDaIa().join('\n'), 'o comando que MOSTRA o estado tem de explicar o problema').toContain('ILEGIVEL')
})

test('e o arquivo ILEGIVEL nao e SOBRESCRITO — a preferencia dos outros papeis sobrevive', async () => {
  const { writeFileSync, readFileSync } = await import('node:fs')
  const M = await import('../../motor/mir/escolher-ia.ts')
  const antes = '{ "gate": { "provider": "codex" }, truncad'
  writeFileSync(process.env.HICODE_IA_FILE as string, antes)
  M.aplicar({ papeis: ['implement'], provider: 'claude' })
  expect(readFileSync(process.env.HICODE_IA_FILE as string, 'utf8'), 'gravar por cima apaga o que ainda esta la para o humano consertar').toBe(antes)
})
