// A excecao a parada humana era um flag opt-in (apesarDaParada) que TODO
// chamador precisava lembrar — e o unico modulo novo do repo esqueceu, com
// updateCard devolvendo ok num pedido que virou campo morto (raio-x, item 16).
// Agora a excecao tem UMA porta com nome: updateCardPorAcaoHumana. O invariante
// abaixo proibe o flag cru fora do store — quem precisar tirar card de
// PAUSED/HALTED e obrigado a passar pela porta, visivel no grep e na revisao.
import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const CARDS = mkdtempSync(join(tmpdir(), 'hicode-porta-'))
process.env.HICODE_CARDS_DIR = CARDS

const { createCard, readCard, patchCard, updateCardPorAcaoHumana } = await import('../../motor/cordel/store.ts')

afterAll(() => rmSync(CARDS, { recursive: true, force: true }))

test('patch comum NAO tira o card da parada humana; a porta nomeada tira', () => {
  const id = createCard({ title: 'parado', status: 'PAUSED', repo: 'org/repo' }, '## Objetivo\np\n')
  patchCard(id, { status: 'URL_OK' }, 'tentativa de job em voo')
  expect(readCard(id)?.fm.status, 'sem a porta, a parada humana fica de pe').toBe('PAUSED')
  updateCardPorAcaoHumana(id, { fields: { status: 'URL_OK' }, log: 'pedido humano' })
  expect(readCard(id)?.fm.status).toBe('URL_OK')
})

function arquivosTs(dir: string): string[] {
  const fora: string[] = []
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) fora.push(...arquivosTs(caminho))
    else if (nome.endsWith('.ts')) fora.push(caminho)
  }
  return fora
}

test('INVARIANTE: o flag cru apesarDaParada so existe dentro de cordel/store.ts — todo mundo usa a porta', () => {
  const violacoes = arquivosTs('motor')
    .filter(f => !f.endsWith(join('cordel', 'store.ts')))
    .filter(f => readFileSync(f, 'utf8').includes('apesarDaParada'))
  expect(violacoes, 'tirar card de parada humana fora da porta nomeada e exatamente o esquecimento que o item 16 documentou').toEqual([])
})
