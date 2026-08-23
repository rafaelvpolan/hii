import { test, expect, afterAll } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-prorfao-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(join(process.env.HICODE_CARDS_DIR, 'runs'), { recursive: true })
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const { executarComIdempotencia } = await import('../motor/qlb/slv/idempotencia')
const { eventosDoCard } = await import('../motor/euc/eventos')

// Reproduz o cenario da Parte VI do MODERNIZATION.md: o `gh pr create` roda e
// devolve a url, e o processo morre ANTES de o card gravar pr_url. No reinicio,
// reconcileStranded devolve o card de CLEANED para URL_OK e o finish roda de
// novo. Sem SLV, `pularCriacaoDePr('')` e falso e um SEGUNDO PR e aberto.
async function tentarAbrirPr(id: string, prNoCard: string, contador: { n: number }): Promise<string> {
  const r = await executarComIdempotencia({
    card: id,
    fase: 'ctr',
    operacao: 'pr_create',
    executar: (): Promise<string> => {
      if (prNoCard) return Promise.resolve(prNoCard)
      contador.n++
      return Promise.resolve(`https://github.com/org/repo/pull/${contador.n}`)
    },
  })
  return r.resultado
}

test('REGRESSAO crash entre `gh pr create` e a gravacao do card NAO abre um segundo PR', async () => {
  const id = 'crash-1'
  const chamadasAoGh = { n: 0 }

  // 1a passada: abre o PR e o processo morre antes de patchCard gravar pr_url.
  const primeira = await tentarAbrirPr(id, '', chamadasAoGh)
  expect(primeira).toBe('https://github.com/org/repo/pull/1')

  // 2a passada apos o reinicio: o card ainda esta com pr_url vazio.
  const segunda = await tentarAbrirPr(id, '', chamadasAoGh)

  expect(chamadasAoGh.n, 'o gh pr create rodou mais de uma vez — PR duplicado').toBe(1)
  expect(segunda).toBe(primeira)
})

test('a url fica no diario no instante em que o gh devolve, nao depois do worktree sair', async () => {
  const id = 'crash-2'
  await tentarAbrirPr(id, '', { n: 40 })
  const registrado = eventosDoCard(id).find(e => e.evento === 'efeito_registrado' && e.chave === `${id}:ctr:pr_create`)
  expect(registrado?.resultado).toBe('https://github.com/org/repo/pull/41')
  expect(registrado?.detalhe).toBe('pr_create')
})

test('card que ja tinha pr_url no frontmatter continua nao reabrindo PR', async () => {
  const id = 'crash-3'
  const chamadas = { n: 0 }
  const url = await tentarAbrirPr(id, 'https://github.com/org/repo/pull/99', chamadas)
  expect(url).toBe('https://github.com/org/repo/pull/99')
  expect(chamadas.n).toBe(0)
})
