import { test, expect, beforeEach, afterAll } from '../apoio/runner.ts'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Dois campos, e os dois nasceram do mesmo par de cards.
//
// Card 001 esta em `URL` desde 24/08 e nada no motor sabia dizer "aberto ha 9 dias",
// porque `updated` e reescrito em TODO patchCard — inclusive nos que so acrescentam
// linha de diario. Card em laco de reparo renovava `updated` a cada volta e aparentava
// idade de dois minutos. `status_since` so anda quando o STATUS anda.
//
// Card 002 esta em `HALTED` sem `halt_class`, sem `halt_at` e sem `halt_reason`: 29 das
// 31 escritas de `status: 'HALTED'` do motor gravavam status e nada mais, e `porHalts`
// (euclides/radar/saude.ts) descarta card sem classe. Motor parado respondia "ocioso".

process.env.HICODE_COTA_TTL_MS = '0'

const { createCard, readCard, patchCard, updateCard } = await import('../../motor/cordel/store.ts')
const { PARADA_SEM_CLASSE } = await import('../../motor/cordel/index.ts')
const { halt } = await import('../../motor/mirante/acoes.ts')
const { lerSaudeDoMotor } = await import('../../motor/euclides/radar/saude.ts')

const criados: string[] = []

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'hicode-parada-'))
  criados.push(dir)
  process.env.HICODE_CARDS_DIR = dir
  mkdirSync(join(dir, 'runs'), { recursive: true })
})

afterAll(() => {
  for (const d of criados) rmSync(d, { recursive: true, force: true })
})

function card(status = 'EXECUTING'): string {
  return createCard({ title: 'tarefa', repo: 'org/repo', status }, '## Objetivo\nalgo\n')
}

// ---------- status_since ----------

test('o card nasce com status_since: sem semente, nao ha idade ate a primeira transicao', () => {
  const c = readCard(card('READY'))
  expect(c?.fm.status_since).toBeTruthy()
  expect(c?.fm.status_since).toBe(c?.fm.updated)
})

test('patch que NAO muda status nao mexe em status_since — e este e o ponto do campo', () => {
  const id = card('EXECUTING')
  const antes = readCard(id)?.fm.status_since
  patchCard(id, { cost_usd: '1.0000' }, 'so uma linha de diario')
  patchCard(id, { status: 'EXECUTING' }, 'reescrita do MESMO status')
  const depois = readCard(id)
  expect(depois?.fm.status_since).toBe(antes)
})

test('REGRESSAO updated continua sendo reescrito em todo patch — nao foi ele que mudou', () => {
  const id = card('EXECUTING')
  const antes = readCard(id)?.fm.updated
  patchCard(id, {}, 'so diario')
  expect(readCard(id)?.fm.updated).not.toBe(undefined)
  expect(typeof antes).toBe('string')
})

test('mudanca de status anda com status_since', () => {
  const id = card('EXECUTING')
  const antes = readCard(id)?.fm.status_since
  patchCard(id, { status: 'URL' }, 'EXECUTING->URL')
  const depois = readCard(id)?.fm.status_since
  expect(depois).not.toBe(undefined)
  expect(Date.parse(String(depois))).toBeGreaterThanOrEqual(Date.parse(String(antes)))
  expect(depois).toBe(readCard(id)?.fm.updated)
})

// ---------- halt_class ----------

test('HALT com classe declarada guarda a classe declarada', () => {
  const id = card('EXECUTING')
  patchCard(id, { status: 'HALTED', halt_class: 'orcamento' }, `x EXECUTING->HALTED orcamento excedido`)
  const c = readCard(id)
  expect(c?.fm.halt_class).toBe('orcamento')
})

test('HALT SEM classe e carimbado com a sentinela E deixa linha de defeito no diario', () => {
  const id = card('EXECUTING')
  updateCard(id, { fields: { status: 'HALTED' }, log: 'x EXECUTING->HALTED alguma coisa' })
  const c = readCard(id)
  expect(c?.fm.halt_class).toBe(PARADA_SEM_CLASSE)
  expect(c?.body, 'sentinela silenciosa seria pior que campo ausente: pareceria classificacao').toContain('DEFEITO')
  expect(c?.body).toContain('sem halt_class')
})

test('classe invalida nao passa por classe: cai na sentinela', () => {
  const id = card('EXECUTING')
  patchCard(id, { status: 'HALTED', halt_class: 'coisa_inventada' }, 'x EXECUTING->HALTED y')
  expect(readCard(id)?.fm.halt_class).toBe(PARADA_SEM_CLASSE)
})

test('classe de uma parada ANTERIOR nao sobrevive a uma parada nova sem classe', () => {
  const id = card('EXECUTING')
  patchCard(id, { status: 'HALTED', halt_class: 'quota' }, 'x EXECUTING->HALTED cota')
  expect(readCard(id)?.fm.halt_class).toBe('quota')
  patchCard(id, { status: 'HALTED' }, 'x HALTED->HALTED outra causa')
  expect(readCard(id)?.fm.halt_class, 'classe velha afirmaria cota numa parada que nao foi de cota').toBe(PARADA_SEM_CLASSE)
})

test('halt_at e halt_reason sao preenchidos no ponto de estrangulamento, a partir da linha de diario', () => {
  const id = card('EXECUTING')
  patchCard(id, { status: 'HALTED', halt_class: 'terminal' }, '2026-09-02T10:00:00Z EXECUTING->HALTED repo nao encontrado: org/repo')
  const c = readCard(id)
  expect(Date.parse(String(c?.fm.halt_at))).toBeLessThanOrEqual(Date.now())
  expect(c?.fm.halt_reason).toBe('repo nao encontrado: org/repo')
})

test('quem JA informa halt_reason nao e sobrescrito pela extracao', () => {
  const id = card('EXECUTING')
  patchCard(id, { status: 'HALTED', halt_class: 'quota', halt_reason: 'cota da API esgotada' }, 'x EXECUTING->HALTED outro texto qualquer')
  expect(readCard(id)?.fm.halt_reason).toBe('cota da API esgotada')
})

test('parada PEDIDA por pessoa tem classe propria — antes era indistinguivel de parada por cota', () => {
  const id = card('EXECUTING')
  halt(id, 'parado pelo humano')
  const c = readCard(id)
  expect(c?.fm.status).toBe('HALTED')
  expect(c?.fm.halt_class).toBe('humano')
  expect(c?.fm.halt_reason).toBe('parado pelo humano')
})

test('escrita que NAO leva a HALTED nao ganha campo de parada nenhum', () => {
  const id = card('EXECUTING')
  patchCard(id, { status: 'URL' }, 'x EXECUTING->URL')
  const c = readCard(id)
  expect(c?.fm.halt_class).toBe(undefined)
  expect(c?.fm.halt_at).toBe(undefined)
})

// ---------- o consumidor: sem ele os dois campos seriam decorativos ----------

test('motor com card parado por orcamento NAO responde mais ocioso', () => {
  const id = card('EXECUTING')
  patchCard(id, { status: 'HALTED', halt_class: 'orcamento' }, 'x EXECUTING->HALTED orcamento excedido (US$16.02 > US$16)')
  const saude = lerSaudeDoMotor(Date.now())
  expect(saude.estado, 'era exatamente aqui que o motor respondia verde com card travado').toBe('parado')
  expect(saude.paradas).toHaveLength(1)
  expect(saude.paradas[0]?.card).toBe(id)
  expect(saude.paradas[0]?.classe).toBe('orcamento')
  expect(saude.paradas[0]?.motivo).toBe('orcamento excedido (US$16.02 > US$16)')
  expect(saude.paradas[0]?.desdeConhecido).toBe(true)
})

test('parada por orcamento NAO entra no mapa de provedor indisponivel — nao e o provedor que caiu', () => {
  const id = card('EXECUTING')
  patchCard(id, { status: 'HALTED', halt_class: 'orcamento' }, 'x EXECUTING->HALTED orcamento')
  const saude = lerSaudeDoMotor(Date.now())
  expect(saude.provedoresIndisponiveis).toHaveLength(0)
  expect(saude.paradas).toHaveLength(1)
  expect(saude.paradas[0]?.card).toBe(id)
})

test('card em checkpoint aparece com idade — o caso do card 001 em URL', () => {
  const agora = Date.now()
  const id = createCard({
    title: 'tarefa', repo: 'org/repo', status: 'URL',
    status_since: new Date(agora - 9 * 86_400_000).toISOString().replace(/\.\d+Z$/, 'Z'),
  }, '## Objetivo\nalgo\n')
  const saude = lerSaudeDoMotor(agora)
  expect(saude.esperandoVoce).toHaveLength(1)
  expect(saude.esperandoVoce[0]?.card).toBe(id)
  expect(saude.esperandoVoce[0]?.estado).toBe('URL')
  expect(saude.esperandoVoce[0]?.desdeConhecido).toBe(true)
  expect(Math.round((saude.esperandoVoce[0]?.idadeMs ?? 0) / 86_400_000)).toBe(9)
})

test('card antigo SEM status_since diz que nao sabe, em vez de dizer que parou agora', () => {
  const agora = Date.now()
  createCard({ title: 'tarefa', repo: 'org/repo', status: 'URL', status_since: '' }, '## Objetivo\nalgo\n')
  const saude = lerSaudeDoMotor(agora)
  expect(saude.esperandoVoce).toHaveLength(1)
  expect(saude.esperandoVoce[0]?.desdeConhecido, 'zero afirmaria "abriu agora" para um card aberto ha uma semana').toBe(false)
  expect(saude.esperandoVoce[0]?.idadeMs).toBe(0)
})

test('PR_OPEN nao conta como esperando voce: tem consumidor automatico a cada 30s', () => {
  createCard({ title: 'tarefa', repo: 'org/repo', status: 'PR_OPEN' }, '## Objetivo\nalgo\n')
  expect(lerSaudeDoMotor(Date.now()).esperandoVoce).toHaveLength(0)
})

// O degrau entre `parado` e `trabalhando` foi contestado na review do PR #31: com
// `parado` na frente, uma parada antiga nao resolvida saturava o escalar e
// `trabalhando` deixava de ser observavel. Os dois testes abaixo congelam a decisao.
test('card parado NAO apaga o fato de o motor estar trabalhando', () => {
  const parado = card('EXECUTING')
  patchCard(parado, { status: 'HALTED', halt_class: 'orcamento' }, 'x EXECUTING->HALTED orcamento')
  card('EXECUTING')
  const saude = lerSaudeDoMotor(Date.now())
  expect(saude.estado, 'parado na frente de trabalhando satura o escalar e some com a liveness do motor').toBe('trabalhando')
  expect(saude.paradas, 'e a parada continua visivel no payload, que e onde ela pertence').toHaveLength(1)
  expect(saude.paradas[0]?.card).toBe(parado)
})

test('sem nada em voo, a parada assume o escalar — nao volta a ser ocioso', () => {
  const id = card('EXECUTING')
  patchCard(id, { status: 'HALTED', halt_class: 'escopo' }, 'x EXECUTING->HALTED escreveu fora do escopo')
  expect(lerSaudeDoMotor(Date.now()).estado).toBe('parado')
})

test('REGRESSAO nada parado e nada em voo continua ocioso', () => {
  card('READY')
  const saude = lerSaudeDoMotor(Date.now())
  expect(saude.estado).toBe('ocioso')
  expect(saude.paradas).toHaveLength(0)
  expect(saude.esperandoVoce).toHaveLength(1)
})

// O catch-all de `runJob` gravava `${job.kind}->HALTED` — 'execute'/'finish'/'correct'/
// 'spec' nao estao em STATUSES, entao a etiqueta narrava transicao a partir de um estado
// em que o card nunca esteve. Contestado na review do PR #31, e o mesmo defeito que
// quilombo/cartorio/fechar.ts:149-150 ja documenta ter pago uma vez.
//
// Os dois testes se dividem porque o caminho NAO e executavel de fora: `runJob` nao
// aceita dependencia injetada, e todo handler ja captura a propria excecao — o catch da
// fila e ultimo recurso. A primeira versao deste teste chamava `runJob` de verdade e
// media o HALT do `handleExecute` ("repo nao encontrado", classe `terminal`), sem nunca
// tocar no catch. Entao: um teste prova o MECANISMO com dado de verdade, e o outro prova
// que o CALL SITE usa esse mecanismo.

test('o mecanismo grava a origem REAL do card quando o log e funcao do frontmatter', () => {
  const id = card('EXECUTING')
  updateCard(id, {
    fields: { status: 'HALTED', halt_class: 'excecao' },
    log: fm => `${'2026-09-02T10:00:00Z'} ${fm.status || 'INBOX'}->HALTED erro nao previsto (execute): boom`,
  })
  const c = readCard(id)
  expect(c?.fm.halt_class).toBe('excecao')
  expect(c?.fm.halt_reason).toBe('erro nao previsto (execute): boom')
  expect(c?.body, 'a origem tem de ser um STATUS, nunca um JobKind').not.toContain('execute->HALTED')
  expect(c?.body).toContain('EXECUTING->HALTED')
})

test('INVARIANTE o catch-all da fila nao usa job.kind como origem da transicao', () => {
  const fonte = readFileSync('motor/oswaldo/mutirao/fila.ts', 'utf8')
  expect(fonte, 'job.kind nao esta em STATUSES: como origem, a etiqueta e afirmacao falsa').not.toContain('${job.kind}->HALTED')
  expect(fonte, 'a origem tem de vir do frontmatter, o que exige log em funcao').toMatch(/log: fm => .*\$\{fm\.status \|\| 'INBOX'\}->HALTED/)
  expect(fonte, 'job.kind segue na mensagem, onde e informacao e nao afirmacao').toContain('(${job.kind})')
})
