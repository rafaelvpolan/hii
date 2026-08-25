import { test, expect, afterAll, lerArquivo } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-recup-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(join(process.env.HICODE_CARDS_DIR, 'runs'), { recursive: true })
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const { createCard, readCard } = await import('../../motor/cdl/store.ts')
const { reconcileStranded } = await import('../../motor/osw/mtr/estado-da-fila.ts')
const { anexarEvento } = await import('../../motor/euc/eventos.ts')
const { executarComIdempotencia } = await import('../../motor/qlb/slv/idempotencia.ts')
const { orfaosDoCard, temOrfao, prOrfaoDe } = await import('../../motor/qlb/slv/compensacao.ts')
const { faseInterrompida, emAndamento, ultimoPassoConhecido } = await import('../../motor/euc/recuperar.ts')

function cardEm(status: string): string {
  return createCard({ status, title: 't', repo: 'org/app', risk: 'low' }, '## Objetivo\nfazer\n')
}

async function registrarPrAberto(id: string, url: string): Promise<void> {
  await executarComIdempotencia({
    card: id, fase: 'ctr', operacao: 'pr_create',
    executar: (): Promise<string> => Promise.resolve(url),
  })
}

test('REGRESSAO card em CLEANED com PR ja no diario vira PR_OPEN, nao volta para URL_OK', async () => {
  const id = cardEm('CLEANED')
  await registrarPrAberto(id, 'https://github.com/org/repo/pull/12')

  reconcileStranded()

  const card = readCard(id)
  expect(card?.fm.status, 'reiniciar o finish aqui abriria um segundo PR').toBe('PR_OPEN')
  expect(card?.fm.pr_url).toBe('https://github.com/org/repo/pull/12')
  expect(temOrfao(id, 'pr_orfao'), 'o orfao tem de ficar visivel, nao ser resolvido em silencio').toBe(true)
})

test('card em CLEANED sem PR no diario continua voltando para URL_OK', () => {
  const id = cardEm('CLEANED')
  reconcileStranded()
  expect(readCard(id)?.fm.status).toBe('URL_OK')
  expect(orfaosDoCard(id)).toEqual([])
})

test('card que ja tem pr_url no frontmatter nao e tratado como orfao', async () => {
  const id = cardEm('REVIEWED')
  await registrarPrAberto(id, 'https://github.com/org/repo/pull/13')
  expect(prOrfaoDe(id, 'https://github.com/org/repo/pull/13')).toBeNull()
})

test('o orfao registra o motivo — quem ler o diario depois entende o que houve', async () => {
  const id = cardEm('SEC_CLEARED')
  await registrarPrAberto(id, 'https://github.com/org/repo/pull/14')
  reconcileStranded()
  const orfao = orfaosDoCard(id)[0]
  expect(orfao?.chave).toBe('pr_orfao')
  expect(orfao?.detalhe).toContain('pull/14')
  expect(orfao?.detalhe).toContain('SEC_CLEARED')
})

test('fase aberta sem fechamento e detectada como interrompida', () => {
  const id = cardEm('EXECUTING')
  anexarEvento({ card: id, evento: 'gate_start', fase: 'testes' })
  const f = faseInterrompida(id)
  expect(f?.fase).toBe('testes')
  expect(f?.evento.evento).toBe('gate_start')
})

test('fase que fechou nao conta como interrompida', () => {
  const id = cardEm('EXECUTING')
  anexarEvento({ card: id, evento: 'gate_start', fase: 'testes' })
  anexarEvento({ card: id, evento: 'gate_verdict', fase: 'testes', detalhe: 'ok' })
  expect(faseInterrompida(id)).toBeNull()
})

test('gate_verdict de OUTRA fase nao fecha a fase aberta', () => {
  const id = cardEm('EXECUTING')
  anexarEvento({ card: id, evento: 'gate_start', fase: 'seguranca' })
  anexarEvento({ card: id, evento: 'gate_verdict', fase: 'testes', detalhe: 'ok' })
  expect(faseInterrompida(id)?.fase).toBe('seguranca')
})

test('card sem evento final conta como em andamento; com card_fechado, nao', () => {
  const id = cardEm('EXECUTING')
  anexarEvento({ card: id, evento: 'fase_inicio', fase: 'implementacao' })
  expect(emAndamento(id)).toBe(true)
  expect(ultimoPassoConhecido(id)).toBe('fase_inicio:implementacao')
  anexarEvento({ card: id, evento: 'card_fechado' })
  expect(emAndamento(id)).toBe(false)
})

test('INVARIANTE toda saida de passoComCrivo fecha a fase — senao falha limpa parece crash', async () => {
  const fonte = await lerArquivo('motor/cic/passo-com-gate.ts')
  const saidas = (fonte.match(/return \{ metric:/g) ?? []).length
  // Conta so linha de CODIGO: um comentario contendo o literal inflaria o
  // numero e mascararia uma saida de verdade sem fechamento.
  const fechamentos = fonte.split('\n')
    .filter(l => !l.trimStart().startsWith('//'))
    .filter(l => l.includes("evento: 'fase_fim'")).length
  expect(saidas, 'a varredura nao achou as saidas — o invariante passaria vazio').toBeGreaterThan(2)
  expect(fechamentos, `${saidas} saida(s) e ${fechamentos} fase_fim: alguma saida deixa a fase aberta`).toBe(saidas)
})

test('gate_start sem gate_verdict e o unico jeito de a fase ficar aberta no diario', () => {
  const id = cardEm('EXECUTING')
  anexarEvento({ card: id, evento: 'fase_inicio', fase: 'testes' })
  anexarEvento({ card: id, evento: 'gate_start', fase: 'testes' })
  anexarEvento({ card: id, evento: 'gate_verdict', fase: 'testes', detalhe: 'APPROVED' })
  anexarEvento({ card: id, evento: 'fase_fim', fase: 'testes', detalhe: 'aprovada' })
  expect(faseInterrompida(id)).toBeNull()
})
