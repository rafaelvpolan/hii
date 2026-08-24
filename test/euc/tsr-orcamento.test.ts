import { test, expect, afterAll } from 'bun:test'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-orcamento-'))
afterAll(() => {
  rmSync(BASE, { recursive: true, force: true })
  delete process.env.HICODE_TIER_FILE
})

const G = await import('../../motor/euc/tsr/orcamento.ts')

let n = 0
function comArquivo<T>(conteudo: string, fn: () => T): T {
  const caminho = join(BASE, `tier-${n++}.json`)
  writeFileSync(caminho, conteudo)
  process.env.HICODE_TIER_FILE = caminho
  try {
    return fn()
  } finally {
    delete process.env.HICODE_TIER_FILE
  }
}

test('o arquivo real do repo e legivel e cobre as acoes que o motor executa', () => {
  const g = G.lerGovernanca()
  for (const acao of G.ACOES_GOVERNADAS) {
    expect(g.criterios[acao], `acao "${acao}" sem tier declarado`).toBeDefined()
    expect(g.criterios[acao]?.motivo, `acao "${acao}" sem motivo — tier sem porque nao e auditavel`).toBeTruthy()
  }
})

test('arquivo ausente LANCA — cair para "sem governanca" seria decidir custo por habito de novo', () => {
  process.env.HICODE_TIER_FILE = join(BASE, 'nao-existe.json')
  expect(() => G.lerGovernanca()).toThrow('nao encontrado')
  delete process.env.HICODE_TIER_FILE
})

test('arquivo ilegivel LANCA em vez de virar lista vazia', () => {
  comArquivo('{{{', () => expect(() => G.lerGovernanca()).toThrow('ilegivel'))
})

test('tier desconhecido no arquivo LANCA — nome errado nao pode virar tier barato calado', () => {
  const cru = JSON.stringify({ versao: 1, padrao: 'tier2_padrao', criterios: { arquitetura: { tier: 'tier9_inventado', motivo: 'x' } }, orcamentoPorCard: { tetoUsd: 5, acaoAoEstourar: 'pausar' } })
  comArquivo(cru, () => expect(() => G.lerGovernanca()).toThrow('tier9_inventado'))
})

test('criterio sem motivo LANCA — o motivo e o que torna o custo auditavel', () => {
  const cru = JSON.stringify({ versao: 1, padrao: 'tier2_padrao', criterios: { arquitetura: { tier: 'tier1_caro' } }, orcamentoPorCard: { tetoUsd: 5, acaoAoEstourar: 'pausar' } })
  comArquivo(cru, () => expect(() => G.lerGovernanca()).toThrow('motivo'))
})

test('teto por card ausente ou zero LANCA — orcamento opcional nao e orcamento', () => {
  const semTeto = JSON.stringify({ versao: 1, padrao: 'tier2_padrao', criterios: { arquitetura: { tier: 'tier1_caro', motivo: 'x' } } })
  comArquivo(semTeto, () => expect(() => G.lerGovernanca()).toThrow('orcamentoPorCard'))
})

test('REGRA DE SUBIDA elevar o tier vale, baixar nunca', () => {
  expect(G.elevarTier('tier3_barato', 'tier1_caro')).toBe('tier1_caro')
  expect(G.elevarTier('tier1_caro', 'tier3_barato'), 'baixar o rigor pelo card e o vetor que a LEI fecha').toBe('tier1_caro')
  expect(G.elevarTier('tier2_padrao', 'tier2_padrao')).toBe('tier2_padrao')
})

test('tierPara devolve tier e motivo da acao, e o motivo vai junto para o diario', () => {
  const escolha = G.tierPara('seguranca')
  expect(escolha.tier).toBe('tier1_caro')
  expect(escolha.motivo).toContain('falso negativo')
})

test('acao fora do catalogo NAO cai em tier barato — usa o padrao declarado no arquivo', () => {
  const escolha = G.tierPara('acao-que-nao-existe')
  expect(escolha.tier).toBe(G.lerGovernanca().padrao)
  expect(escolha.motivo).toContain('padrao')
})

test('o teto do card vem do arquivo versionado, nao mais de env com default zero', () => {
  delete process.env.HICODE_CARD_BUDGET_USD
  expect(G.tetoDoCard()).toBe(G.lerGovernanca().orcamentoPorCard.tetoUsd)
  expect(G.tetoDoCard(), 'default zero era orcamento desligado — governanca que nao governa').toBeGreaterThan(0)
})

test('env continua vencendo o arquivo, para quem ja calibrou o proprio teto', () => {
  process.env.HICODE_CARD_BUDGET_USD = '3'
  try {
    expect(G.tetoDoCard()).toBe(3)
  } finally {
    delete process.env.HICODE_CARD_BUDGET_USD
  }
})

function arquivosDoMotor(raiz = 'motor'): string[] {
  const fora: string[] = []
  for (const nome of readdirSync(raiz)) {
    const caminho = join(raiz, nome)
    if (statSync(caminho).isDirectory()) fora.push(...arquivosDoMotor(caminho))
    else if (nome.endsWith('.ts')) fora.push(caminho)
  }
  return fora
}

test('INVARIANTE nenhum ponto do motor le o teto de outro lugar que nao o governado', () => {
  const todos = arquivosDoMotor()
  expect(todos.length, 'a varredura precisa enxergar os arquivos').toBeGreaterThan(100)
  const fora = todos
    .filter(f => f !== join('motor', 'euc', 'tsr', 'orcamento.ts'))
    .filter(f => readFileSync(f, 'utf8').includes('CARD_BUDGET_USD'))
  expect(fora, 'teto lido de duas fontes vira orcamento que barra num ponto e nao no outro').toEqual([])
})

test('INVARIANTE quem barra por orcamento chama tetoDoCard', async () => {
  for (const arquivo of ['motor/osw/executar.ts', 'motor/cic/corrigir.ts', 'motor/qlb/ctr/fechar.ts']) {
    const fonte = await Bun.file(arquivo).text()
    expect(fonte.includes('tetoDoCard()'), `${arquivo} tem de ler o teto governado`).toBe(true)
  }
})

test('model_tier_selected e um tipo de evento do diario, nao texto solto', async () => {
  const { TIPOS_DE_EVENTO } = await import('../../motor/euc/eventos.ts')
  expect(TIPOS_DE_EVENTO).toContain('model_tier_selected')
})
