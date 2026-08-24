import { test, expect, afterAll } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// O cards dir tem de valer ANTES do primeiro import de store.ts — dai o arquivo
// proprio em vez de um teste dentro de topologia.test.ts.
const BASE = mkdtempSync(join(tmpdir(), 'hicode-deriva-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(join(process.env.HICODE_CARDS_DIR, 'runs'), { recursive: true })
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const { createCard, patchCard, readCard } = await import('../../motor/cdl/store.ts')
const { esquecerTopologia, observarDeriva, derivasVistas } = await import('../../motor/nmy/deriva-de-transicao.ts')

// A topologia era conferida por grep no texto-fonte, e o grep comparava so o
// DESTINO — nao podia reprovar par nenhum. O par (origem, destino) existe de
// verdade num lugar so: o ponto de escrita do card. Este teste prova que a
// conferencia acontece la, no caminho que a producao usa.
function comObservador<T>(corpo: (vistas: string[]) => T): T {
  esquecerTopologia()
  const vistas: string[] = []
  observarDeriva(d => vistas.push(`${d.de}->${d.para}`))
  try {
    return corpo(vistas)
  } finally {
    observarDeriva(null)
    esquecerTopologia()
  }
}

// createCard devolve o ID (string), nao o card. A primeira versao deste arquivo
// lia `.id` de uma string, recebia undefined, e patchCard virava no-op — quatro
// dos cinco testes esperavam `[]` e passavam sem exercitar nada. Ficou aqui como
// nota porque e o mesmo erro que a auditoria cobra: teste que nao pode falhar.
function novoCard(status: string): string {
  const id = createCard({ status, title: `deriva ${status}` }, '## Objetivo\nx\n')
  const lido = readCard(id)
  expect(lido?.fm.status, 'fixture nao foi criado: o resto do teste nao provaria nada').toBe(status)
  return id
}

test('trocar o status por um par DECLARADO nao acende alarme', () => {
  comObservador((vistas) => {
    const id = novoCard('READY')
    patchCard(id, { status: 'EXECUTING' })
    expect(readCard(id)?.fm.status, 'sem a escrita, esperar [] nao prova nada').toBe('EXECUTING')
    expect(vistas).toEqual([])
  })
})

test('trocar o status por um par NAO declarado acende o alarme, no caminho real de escrita', () => {
  comObservador((vistas) => {
    const id = novoCard('READY')
    patchCard(id, { status: 'DEPLOYED' })
    expect(vistas, 'READY->DEPLOYED nao esta em transicoes nem em transicoesDeRecuperacao').toEqual(['READY->DEPLOYED'])
    expect(derivasVistas()).toContain('READY->DEPLOYED')
  })
})

test('rota de RECUPERACAO declarada nao acende alarme — senao todo reinicio de daemon gritaria', () => {
  comObservador((vistas) => {
    const id = novoCard('CLEANED')
    patchCard(id, { status: 'URL_OK' })
    expect(readCard(id)?.fm.status).toBe('URL_OK')
    expect(vistas, 'reconcileStranded faz exatamente isto apos reinicio').toEqual([])
  })
})

test('escrita que NAO troca o status nao passa pela conferencia', () => {
  comObservador((vistas) => {
    const id = novoCard('EXECUTING')
    patchCard(id, { wait_attempts: 'x' })
    expect(readCard(id)?.fm.wait_attempts).toBe('x')
    patchCard(id, { status: 'EXECUTING' })
    expect(vistas).toEqual([])
  })
})

test('HALTED continua alcancavel de qualquer estado sem virar deriva', () => {
  comObservador((vistas) => {
    for (const de of ['READY', 'EXECUTING', 'URL_OK', 'CLEANED', 'PR_OPEN']) {
      const id = novoCard(de)
      patchCard(id, { status: 'HALTED' })
      expect(readCard(id)?.fm.status, `${de} -> HALTED nao foi escrito`).toBe('HALTED')
    }
    expect(vistas, 'parar nunca depende de rota').toEqual([])
  })
})

// O dedup do observador e por PROCESSO: um `hii` de linha de comando morre em
// segundos levando o aviso do stderr com ele. Sem registro no diario, deriva
// ocorrida ali sumia sem rastro auditavel.
test('a deriva vai para o DIARIO do card, nao so para o stderr', async () => {
  const { eventosDoCard } = await import('../../motor/euc/eventos.ts')
  const id = novoCard('READY')
  esquecerTopologia()
  patchCard(id, { status: 'DEPLOYED' })
  const derivas = eventosDoCard(id).filter(e => e.evento === 'transicao_nao_declarada')
  expect(derivas.length, 'sem evento no diario a deriva nao e auditavel depois').toBe(1)
  expect(derivas[0]?.chave).toBe('READY->DEPLOYED')
  esquecerTopologia()
})

test('transicao DECLARADA nao deixa evento de deriva no diario', async () => {
  const { eventosDoCard } = await import('../../motor/euc/eventos.ts')
  const id = novoCard('READY')
  patchCard(id, { status: 'EXECUTING' })
  expect(eventosDoCard(id).filter(e => e.evento === 'transicao_nao_declarada')).toEqual([])
})

test('transicao_nao_declarada e um tipo de evento do diario, nao texto solto', async () => {
  const { TIPOS_DE_EVENTO } = await import('../../motor/euc/eventos.ts')
  expect(TIPOS_DE_EVENTO).toContain('transicao_nao_declarada')
})
