import { test, expect, afterAll, lerArquivo } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-idem-contrato-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(join(process.env.HICODE_CARDS_DIR, 'runs'), { recursive: true })
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const { executarComIdempotencia, chaveDeEfeito, efeitoJaProduzido } = await import('../../motor/quilombo/salvo-conduto/idempotencia.ts')
const { eventosDoCard } = await import('../../motor/euclides/eventos.ts')

function efeitosDe(card: string): string[] {
  return eventosDoCard(card).filter(e => e.evento === 'efeito_registrado').map(e => e.chave ?? '')
}

test('CONTRATO executar que LANCA propaga e NAO grava efeito — o retry continua possivel', async () => {
  let tentativas = 0
  const op = {
    card: 'ctr-lanca',
    fase: 'cartorio',
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
    fase: 'cartorio',
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
  expect(efeitoJaProduzido('ctr-recupera', 'cartorio', 'pr_create')).toBe('https://github.com/org/repo/pull/1')
})

test('CONTRATO a mesma operacao em cards diferentes nao colide', async () => {
  const executar = async (): Promise<string> => 'feito'
  await executarComIdempotencia({ card: 'ctr-a', fase: 'cartorio', operacao: 'pr_create', executar })
  const b = await executarComIdempotencia({ card: 'ctr-b', fase: 'cartorio', operacao: 'pr_create', executar })
  expect(b.reaproveitada, 'o efeito do card A nao pode contar como efeito do card B').toBe(false)
  expect(chaveDeEfeito('ctr-a', 'cartorio', 'pr_create')).not.toBe(chaveDeEfeito('ctr-b', 'cartorio', 'pr_create'))
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
  'motor/cascudo/freire/aprendiz.ts',
  'motor/niemeyer/lucio/matriz-entendimento.ts',
  'motor/quilombo/cartorio/pr.ts',
  'motor/tomada/ponte/tarefas/github-issues.ts',
]

test('REGISTRO os chamadores de executarComIdempotencia sao exatamente os declarados aqui', () => {
  const chamadores = arquivosDoMotor()
    .filter(f => f !== join('motor', 'quilombo', 'salvo-conduto', 'idempotencia.ts'))
    .filter(f => readFileSync(f, 'utf8').includes('executarComIdempotencia('))
    .sort()
  expect(chamadores, 'efeito externo novo tem de ser declarado aqui — a lista existe para obrigar o autor a decidir o que acontece quando ele falha')
    .toEqual([...EFEITOS_EXTERNOS_DECLARADOS].sort())
})

test('REGISTRO a varredura enxerga os arquivos — senao o invariante passaria vazio', () => {
  expect(arquivosDoMotor().length).toBeGreaterThan(100)
})

// O invariante acima varre quem CHAMA a protecao. Ele nunca podia reprovar o
// defeito que existia: `gh issue comment` ficava FORA de executarComIdempotencia
// e dois `hii sync` geravam dois comentarios na mesma issue de outra pessoa. Quem
// nao chama a protecao e invisivel para uma lista de chamadores.
//
// Este varre pelo lado do EFEITO: toda invocacao de `gh` que MUTA algo no GitHub
// tem de estar num arquivo que passa pela chave, ou declarada como leitura.
const VERBOS_QUE_MUTAM = ['comment', 'create', 'edit', 'close', 'reopen', 'merge', 'delete']
const LEITURAS_DECLARADAS: readonly string[] = [
  "'--version'",
  "'auth', 'status'",
  "'repo', 'view'",
  "'issue', 'list'",
  "'pr', 'view'",
]

// Qualquer forma de chamar o binario `gh`, com o nome como primeiro argumento ou
// como primeiro item de uma lista de argv.
const INVOCA_GH = /\b(?:run|exec|execFile|execFileSync|execSync|spawn|spawnSync)\(\s*\[?\s*'gh'/

interface ChamadaGh {
  readonly arquivo: string
  readonly linha: number
  readonly texto: string
}

// Conta chaves a partir do `executarComIdempotencia(` mais proximo acima: se o
// bloco dele ainda esta aberto na linha da chamada, a chamada esta dentro.
function dentroDeOperacaoIdempotente(c: ChamadaGh): boolean {
  const linhas = readFileSync(c.arquivo, 'utf8').split('\n')
  for (let inicio = c.linha - 2; inicio >= 0; inicio--) {
    if (!(linhas[inicio] ?? '').includes('executarComIdempotencia(')) continue
    let profundidade = 0
    for (let i = inicio; i < c.linha - 1; i++) {
      for (const ch of linhas[i] ?? '') {
        if (ch === '(' || ch === '{') profundidade++
        else if (ch === ')' || ch === '}') profundidade--
      }
    }
    return profundidade > 0
  }
  return false
}

function chamadasDeGh(): ChamadaGh[] {
  const fora: ChamadaGh[] = []
  for (const arquivo of arquivosDoMotor()) {
    const linhas = readFileSync(arquivo, 'utf8').split('\n')
    linhas.forEach((texto, i) => {
      // Varias formas de invocar o binario, nao so `run('gh'`: `spawnSync('gh'`,
      // `Bun.spawn(['gh'`, `execFileSync('gh'`. Sem cobrir as outras, um efeito
      // mutante acrescentado por qualquer uma delas ficava invisivel — e e essa a
      // classe de defeito (segundo comentario na mesma issue) que o invariante
      // nasceu para pegar.
      if (INVOCA_GH.test(texto)) fora.push({ arquivo, linha: i + 1, texto })
    })
  }
  return fora
}

test('a varredura por EFEITO enxerga as chamadas de gh — senao ela passaria vazia', () => {
  expect(chamadasDeGh().length, 'nenhuma chamada de gh encontrada: a regex quebrou e o invariante abaixo vale nada').toBeGreaterThan(4)
})

test('EFEITO toda chamada de gh que MUTA passa pela chave de idempotencia (ou e leitura declarada)', () => {
  const desprotegidas: string[] = []
  for (const c of chamadasDeGh()) {
    const ehLeitura = LEITURAS_DECLARADAS.some(l => c.texto.includes(l))
    if (ehLeitura) continue
    const muta = VERBOS_QUE_MUTAM.some(v => c.texto.includes(`'${v}'`))
    if (!muta) {
      desprotegidas.push(`${c.arquivo}:${c.linha} — verbo de gh nao classificado; declare como leitura ou proteja`)
      continue
    }
    // Por CHAMADA, nao por arquivo: checar `arquivo.includes(...)` deixava um
    // SEGUNDO `gh issue comment` no mesmo arquivo passar verde, que e exatamente a
    // classe de defeito que este invariante nasceu para pegar. A chamada tem de
    // estar DENTRO de um `executar:` de operacao idempotente — na pratica, aninhada
    // depois de um `executarComIdempotencia(` no mesmo arquivo e ANTES do fecho dele.
    if (!dentroDeOperacaoIdempotente(c)) {
      desprotegidas.push(`${c.arquivo}:${c.linha} — muta no GitHub sem estar dentro de executarComIdempotencia`)
    }
  }
  expect(desprotegidas, 'efeito externo repetivel: o retry produz o efeito duas vezes na conta de outra pessoa').toEqual([])
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
  const fonte = await lerArquivo('motor/quilombo/git.ts')
  expect(fonte, 'o motivo da excecao e --force-with-lease; se ele sair, a excecao cai').toContain('--force-with-lease')
})

test('a varredura por CHAMADA reprova um SEGUNDO gh mutante no mesmo arquivo protegido', () => {
  // Prova sintetica do furo antigo: o arquivo TEM executarComIdempotencia, mas a
  // segunda chamada esta fora do bloco dele. A checagem por arquivo dava verde.
  const fonte = [
    "await executarComIdempotencia({",
    "  executar: async () => {",
    "    await run('gh', ['issue', 'comment', n, '--body', b])",
    "    return 'ok'",
    "  },",
    "})",
    "await run('gh', ['issue', 'comment', n, '--body', 'segundo, desprotegido'])",
  ].join('\n')
  const dir = mkdtempSync(join(tmpdir(), 'hicode-efeito-'))
  const arquivo = join(dir, 'x.ts')
  writeFileSync(arquivo, fonte)
  try {
    expect(dentroDeOperacaoIdempotente({ arquivo, linha: 3, texto: '' }), 'a primeira esta dentro').toBe(true)
    expect(dentroDeOperacaoIdempotente({ arquivo, linha: 7, texto: '' }), 'a segunda esta FORA e tem de reprovar').toBe(false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a varredura por EFEITO reconhece TODAS as formas de invocar o gh', () => {
  // Sem isto, trocar `run('gh', [...])` por `spawnSync('gh', [...])` tirava o
  // efeito do radar do invariante.
  for (const forma of [
    "await run('gh', ['issue', 'comment'])",
    "spawnSync('gh', ['issue', 'comment'])",
    "execFileSync('gh', ['pr', 'create'])",
    "Bun.spawn(['gh', 'issue', 'comment'])",
    "await execFile('gh', ['pr', 'edit'])",
  ]) {
    expect(INVOCA_GH.test(forma), forma).toBe(true)
  }
  expect(INVOCA_GH.test("run('git', ['status'])"), 'git nao e gh').toBe(false)
  expect(INVOCA_GH.test("// run('gh', ['issue','comment'])  — exemplo em comentario"), 'comentario tambem conta: melhor falso positivo que furo').toBe(true)
})
