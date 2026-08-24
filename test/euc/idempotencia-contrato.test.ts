import { test, expect, afterAll } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-idem-contrato-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(join(process.env.HICODE_CARDS_DIR, 'runs'), { recursive: true })
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const { executarComIdempotencia, chaveDeEfeito, efeitoJaProduzido } = await import('../../motor/qlb/slv/idempotencia.ts')
const { eventosDoCard } = await import('../../motor/euc/eventos.ts')

function efeitosDe(card: string): string[] {
  return eventosDoCard(card).filter(e => e.evento === 'efeito_registrado').map(e => e.chave ?? '')
}

test('CONTRATO executar que LANCA propaga e NAO grava efeito — o retry continua possivel', async () => {
  let tentativas = 0
  const op = {
    card: 'ctr-lanca',
    fase: 'ctr',
    operacao: 'pr_create',
    executar: async (): Promise<string> => {
      tentativas += 1
      throw new Error('ENOSPC: sem espaco em disco')
    },
  }
  await expect(executarComIdempotencia(op)).rejects.toThrow('ENOSPC')
  expect(efeitosDe('ctr-lanca'), 'gravar aqui trancaria a operacao para sempre').toEqual([])

  await expect(executarComIdempotencia(op)).rejects.toThrow('ENOSPC')
  expect(tentativas, 'a segunda chamada tem de tentar de novo, nao devolver a falha guardada').toBe(2)
})

test('CONTRATO depois de uma falha que lancou, o sucesso seguinte grava normalmente', async () => {
  let falhar = true
  const op = {
    card: 'ctr-recupera',
    fase: 'ctr',
    operacao: 'pr_create',
    executar: async (): Promise<string> => {
      if (falhar) throw new Error('falha transitoria')
      return 'https://github.com/org/repo/pull/1'
    },
  }
  await expect(executarComIdempotencia(op)).rejects.toThrow('transitoria')
  falhar = false
  const r = await executarComIdempotencia(op)
  expect(r.reaproveitada).toBe(false)
  expect(efeitoJaProduzido('ctr-recupera', 'ctr', 'pr_create')).toBe('https://github.com/org/repo/pull/1')
})

test('CONTRATO a mesma operacao em cards diferentes nao colide', async () => {
  const executar = async (): Promise<string> => 'feito'
  await executarComIdempotencia({ card: 'ctr-a', fase: 'ctr', operacao: 'pr_create', executar })
  const b = await executarComIdempotencia({ card: 'ctr-b', fase: 'ctr', operacao: 'pr_create', executar })
  expect(b.reaproveitada, 'o efeito do card A nao pode contar como efeito do card B').toBe(false)
  expect(chaveDeEfeito('ctr-a', 'ctr', 'pr_create')).not.toBe(chaveDeEfeito('ctr-b', 'ctr', 'pr_create'))
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

const EFEITOS_EXTERNOS_DECLARADOS: readonly string[] = [
  'motor/csd/fre/aprendiz.ts',
  'motor/nmy/luc/matriz-entendimento.ts',
  'motor/qlb/ctr/fechar.ts',
]

test('REGISTRO os chamadores de executarComIdempotencia sao exatamente os declarados aqui', () => {
  const chamadores = arquivosDoMotor()
    .filter(f => f !== join('motor', 'qlb', 'slv', 'idempotencia.ts'))
    .filter(f => readFileSync(f, 'utf8').includes('executarComIdempotencia('))
    .sort()
  expect(chamadores, 'efeito externo novo tem de ser declarado aqui — a lista existe para obrigar o autor a decidir o que acontece quando ele falha')
    .toEqual([...EFEITOS_EXTERNOS_DECLARADOS].sort())
})

test('REGISTRO a varredura enxerga os arquivos — senao o invariante passaria vazio', () => {
  expect(arquivosDoMotor().length).toBeGreaterThan(100)
})

const EXCECOES_DECLARADAS: ReadonlyArray<readonly [string, string]> = [
  ['push', 'idempotente por natureza: --force-with-lease ancorado no ultimo push conhecido produz o mesmo estado remoto quando repetido, e recusa quando o remoto mudou'],
  ['merge da resolucao de conflito', 'efeito LOCAL no worktree, nao externo: o commit de merge nao sai da maquina ate o push, que ja tem a garantia acima'],
]

test('REGISTRO as excecoes a chave de idempotencia sao declaradas com o motivo, nao esquecidas', () => {
  expect(EXCECOES_DECLARADAS.length).toBe(2)
  for (const [operacao, motivo] of EXCECOES_DECLARADAS) {
    expect(operacao.length, 'excecao sem nome nao e excecao, e lacuna').toBeGreaterThan(0)
    expect(motivo.length, 'excecao sem motivo escrito e a mesma coisa que nao ter pensado nela').toBeGreaterThan(40)
  }
})

test('REGISTRO push segue fora da chave, e o motivo continua valendo no codigo', async () => {
  const fonte = await Bun.file('motor/qlb/git.ts').text()
  expect(fonte, 'o motivo da excecao e --force-with-lease; se ele sair, a excecao cai').toContain('--force-with-lease')
})
