import { test, expect, afterAll, lerArquivo } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-chg-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(join(process.env.HICODE_CARDS_DIR, 'runs'), { recursive: true })
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const { exigirRedAntesDoGreen, registrarRed, evidenciaDeRed, FASE_RED, lerRelatoDeRed, instrucaoDeRed, origemDoDetalhe, ABRE_RED, FECHA_RED } = await import('../../motor/agentes/chg/red-primeiro.ts')

test('perfil completo sem RED no diario reprova, dizendo o porque', () => {
  const r = exigirRedAntesDoGreen('chg-1', 'completo')
  expect(r.exigido).toBe(true)
  expect(r.satisfeito).toBe(false)
  expect(r.motivo).toContain('FALHOU antes de passar')
})

test('com RED registrado, o perfil completo passa e o motivo cita quando', () => {
  registrarRed('chg-2', 'bun test reprovou antes do reparo')
  const r = exigirRedAntesDoGreen('chg-2', 'completo')
  expect(r.satisfeito).toBe(true)
  expect(r.motivo).toContain('reprovou antes do reparo')
  expect(evidenciaDeRed('chg-2').temRed).toBe(true)
})

test('so o perfil completo exige — nos outros o custo nao paga', () => {
  for (const p of ['padrao', 'enxuto', 'deps', 'externo'] as const) {
    const r = exigirRedAntesDoGreen('chg-3', p)
    expect(r.exigido, `${p} nao deveria exigir RED`).toBe(false)
    expect(r.satisfeito).toBe(true)
  }
})

test('o RED e um evento do diario, na fase propria — nao um campo que o modelo escreve', async () => {
  const { eventosDoCard } = await import('../../motor/euc/eventos.ts')
  registrarRed('chg-4', 'detalhe')
  const ev = eventosDoCard('chg-4').filter(e => e.fase === FASE_RED)
  expect(ev.length).toBe(1)
  expect(ev[0]?.evento).toBe('gate_verdict')
})

test('INVARIANTE o portao de teste registra o RED quando a primeira rodada reprova', async () => {
  const fonte = await lerArquivo('motor/cic/crv/portoes-de-fecho.ts')
  expect(fonte).toContain('registrarRed(o.id')
  expect(fonte, 'so o portao de TESTE produz RED; o de build nao').toContain("portao.id === 'testes'")
})

// Este teste afirmava o CONTRARIO, e com a justificativa invertida ("consultar
// depois do gate nao serviria de nada"). Era ele que mantinha o defeito no lugar: o
// unico produtor da evidencia e registrarRed, que roda DENTRO de testGate
// (motor/cic/crv/portoes-de-fecho.ts:97), entao consultar antes garantia diario
// vazio. red.satisfeito era constante false — com rigor estrito todo card completo
// fazia HALT, e desligado gravava 'nao' mesmo com TDD de verdade.
//
// A ordem no texto-fonte e sentinela, nao prova: quem prova o comportamento sao os
// testes acima, que exercitam registrarRed -> exigirRedAntesDoGreen nessa ordem —
// agora a mesma ordem da producao.
test('INVARIANTE o fechamento consulta o CHG DEPOIS do gate que produz a evidencia', async () => {
  const fonte = await lerArquivo('motor/qlb/ctr/fechar.ts')
  const iChg = fonte.indexOf('exigirRedAntesDoGreen(id, plan.profile)')
  const iGate = fonte.indexOf('await testGate(')
  // Guarda contra o -1: sem isto, apagar qualquer um dos dois faria a comparacao
  // passar por acidente — o defeito que a versao anterior tinha.
  expect(iChg, 'a consulta ao CHG sumiu de fechar.ts').toBeGreaterThan(-1)
  expect(iGate, 'a chamada a testGate sumiu de fechar.ts').toBeGreaterThan(-1)
  expect(iChg > iGate, 'registrarRed vive dentro de testGate: consultar antes le sempre o diario vazio').toBe(true)
})

test('a exigencia e registrada no card mesmo quando nao barra — quem passou sem provar fica visivel', async () => {
  const fonte = await lerArquivo('motor/qlb/ctr/fechar.ts')
  expect(fonte).toContain('red_antes_do_green')
  expect(fonte, 'barrar so quando o operador ligar').toContain('rigorEstrito()')
})

// LIMITE CONHECIDO, documentado aqui para nao virar surpresa quando
// HICODE_RIGOR_ESTRITO=1 for ligado. O unico produtor de evidencia de RED e
// `registrarRed`, chamado quando a PRIMEIRA rodada do comando de teste REPROVA no
// fecho. Consequencia: card `completo` que chega com a suite VERDE nunca tem RED,
// e card que chega quebrado e e reparado passa — o incentivo fica invertido.
//
// Nao foi "consertado" mexendo no gate porque isso mudaria a semantica do item 5
// (ver PENDENCIAS.md, "DECISAO PENDENTE — a evidencia de RED"). O teste existe para
// o comportamento ficar preso e visivel enquanto a decisao nao vem.
test('LIMITE card completo com suite JA VERDE nao tem evidencia de RED', () => {
  const r = exigirRedAntesDoGreen('chg-verde-de-nascenca', 'completo')
  expect(r.exigido).toBe(true)
  expect(r.satisfeito, 'sem RED registrado a exigencia NAO e satisfeita — e com rigor estrito isso e HALT').toBe(false)
  expect(r.motivo).toContain('nao tem evento de RED')
})

test('LIMITE card que chegou QUEBRADO e foi reparado satisfaz a exigencia', () => {
  registrarRed('chg-reparado', 'npm test reprovou antes do reparo')
  const r = exigirRedAntesDoGreen('chg-reparado', 'completo')
  expect(r.satisfeito, 'o caminho que passa hoje e o do card que chegou vermelho').toBe(true)
})

// A saida escolhida para o incentivo invertido: o passo de testes ANEXA a saida
// vermelha antes de implementar. PENDENCIAS.md ja registra a fraqueza dessa opcao —
// "volta a depender do que o modelo diz ter feito" — entao o que o motor CONSEGUE
// conferir naquele texto, ele confere, e o que nao consegue fica MARCADO na origem.
test('bloco de RED ausente nao vale evidencia', () => {
  const r = lerRelatoDeRed('escrevi o teste e ele falhou, depois implementei')
  expect(r.aceito, 'frase nao e saida').toBe(false)
  expect(r.motivo).toContain(ABRE_RED)
})

test('bloco vazio ou com uma frase curta nao vale', () => {
  for (const dentro of ['', '   ', 'falhou']) {
    const r = lerRelatoDeRed(`${ABRE_RED}\n${dentro}\n${FECHA_RED}`)
    expect(r.aceito, JSON.stringify(dentro)).toBe(false)
  }
})

// O caso que faria a exigencia virar carimbo: colar a suite VERDE no bloco.
test('REGRESSAO: saida de suite VERDE colada no bloco e recusada', () => {
  const verde = `bun test v1.3.14\n\n 2540 pass\n 0 fail\n 8000 expect() calls\nRan 2540 tests across 234 files.`
  const r = lerRelatoDeRed(`${ABRE_RED}\n${verde}\n${FECHA_RED}`)
  expect(r.aceito).toBe(false)
  expect(r.motivo).toContain('VERDE')
})

test('saida com falha de verdade e aceita', () => {
  const vermelho = `bun test v1.3.14\n\ntest/x.test.ts:\n(fail) calcula a comissao do plano anual [1.20ms]\nerror: expected 120 to be 132\n\n 3 pass\n 1 fail`
  const r = lerRelatoDeRed(`${ABRE_RED}\n${vermelho}\n${FECHA_RED}`)
  expect(r.aceito, r.motivo).toBe(true)
  expect(r.saida).toContain('(fail)')
})

test('bloco sem o fechamento ainda e lido — modelo corta saida longa', () => {
  const r = lerRelatoDeRed(`${ABRE_RED}\n1 fail, 2 pass\nAssertionError: esperava 120\nem test/comissao.test.ts:14`)
  expect(r.aceito, r.motivo).toBe(true)
})

// Origem MARCADA: relato de agente nao pode se passar por observacao do motor.
test('a evidencia diz de ONDE veio, e as duas origens nao se confundem', () => {
  registrarRed('chg-origem-a', 'testes: (fail) calcula a comissao', 'agente')
  const a = evidenciaDeRed('chg-origem-a')
  expect(a.detalhe).toContain('agente anexou saida')
  expect(origemDoDetalhe(a.detalhe)).toBe('agente')

  registrarRed('chg-origem-m', 'bun test reprovou antes do reparo')
  const m = evidenciaDeRed('chg-origem-m')
  expect(m.detalhe).toContain('motor observou')
  expect(origemDoDetalhe(m.detalhe), 'o padrao continua sendo o motor').toBe('motor')
})

// A instrucao e o leitor tem de falar do MESMO formato: se divergirem, o agente
// obedece um marcador que ninguem le e o passo e recusado sempre.
test('INVARIANTE a instrucao pede exatamente o marcador que o leitor procura', () => {
  const i = instrucaoDeRed('bun run test')
  expect(i).toContain(ABRE_RED)
  expect(i).toContain(FECHA_RED)
  expect(i, 'o comando do alvo entra na instrucao').toContain('bun run test')
  expect(i, 'descrever a falha nao pode ser aceito como alternativa').toContain('cole a saida')
})

// Formas comuns de "verde" em runners diferentes. Cada uma contem a palavra "fail",
// e cada uma passaria se a busca por sinal de falha viesse antes.
test('REGRESSAO: toda forma de contagem ZERO de falhas e recusada', () => {
  for (const verde of [
    ' 2540 pass\n 0 fail\nRan 2540 tests',
    'Tests:       0 failed, 812 passed, 812 total',
    'ℹ fail 0\nℹ pass 52',
    'Test Suites: 0 failed, 30 passed',
    'OK. 100 tests, 0 failures',
    'All tests passed',
  ]) {
    const r = lerRelatoDeRed(`${ABRE_RED}\n${verde}\n-- fim da saida do comando --\n${FECHA_RED}`)
    expect(r.aceito, `aceitou como RED uma saida verde: ${JSON.stringify(verde)}`).toBe(false)
  }
})

test('e a contagem NAO-zero segue aceita', () => {
  for (const vermelho of [
    ' 3 pass\n 1 fail\n(fail) calcula a comissao',
    'Tests:       2 failed, 810 passed, 812 total',
    'ℹ fail 4\nℹ pass 48',
    'FAIL test/comissao.test.ts\n  ● calcula o anual\n    expected 120 to be 132',
  ]) {
    const r = lerRelatoDeRed(`${ABRE_RED}\n${vermelho}\n${FECHA_RED}`)
    expect(r.aceito, `recusou saida vermelha legitima: ${JSON.stringify(vermelho)}`).toBe(true)
  }
})

// O fluxo do fecho: a instrucao so entra no perfil `completo`, e a leitura acontece
// ANTES de testGate. Se rodasse depois, cairia no mesmo defeito de ordem que a Onda C
// consertou — e a evidencia do agente chegaria tarde demais para valer.
test('INVARIANTE a exigencia de RED so entra no perfil completo, e e lida antes do testGate', async () => {
  const fonte = await lerArquivo('motor/qlb/ctr/fechar.ts')
  expect(fonte, 'a instrucao e condicional ao perfil').toContain("step.id === 'testes' && plan.profile === 'completo'")
  const posLeitura = fonte.indexOf('lerRelatoDeRed(r.text)')
  const posGate = fonte.indexOf("step.gate === 'test' && !(await testGate(")
  expect(posLeitura, 'a leitura do relato tem de existir').toBeGreaterThan(0)
  expect(posGate, 'o testGate tem de existir').toBeGreaterThan(0)
  expect(posLeitura < posGate, 'ler o relato DEPOIS do testGate repetiria o defeito de ordem da Onda C').toBe(true)
})

// A opcao escolhida (2 em PENDENCIAS.md) tem uma fraqueza declarada: depende do que
// o agente anexa. O que a torna aceitavel e a evidencia ficar MARCADA — quem audita
// o card ve "agente anexou saida" e nao confunde com "motor observou".
test('INVARIANTE nenhum caminho registra RED de agente sem marcar a origem', async () => {
  const fonte = await lerArquivo('motor/qlb/ctr/fechar.ts')
  // A LINHA inteira, e nao ate o primeiro ")": o argumento e um template literal com
  // chamada dentro, e um regex ganancioso por parenteses corta no lugar errado.
  const chamadas = fonte.split('\n').filter(l => l.includes('registrarRed(') && !l.trimStart().startsWith('//'))
  expect(chamadas.length, 'o fecho tem de registrar RED em algum lugar').toBeGreaterThan(0)
  for (const c of chamadas) {
    expect(c, `registro sem origem explicita: ${c}`).toContain("'agente'")
  }
})
