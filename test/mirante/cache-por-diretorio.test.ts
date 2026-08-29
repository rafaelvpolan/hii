import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const criados: string[] = []
afterAll(() => { for (const d of criados) rmSync(d, { recursive: true, force: true }) })

function dirComCard(id: string): string {
  const d = mkdtempSync(join(tmpdir(), 'hii-cachedir-'))
  criados.push(d)
  mkdirSync(join(d, 'runs'), { recursive: true })
  writeFileSync(join(d, `${id}-slug.md`), `---\nid: ${id}\nstatus: EXECUTING\ntitle: t\nrepo: org/app\n---\n## Objetivo\nx\n`)
  return d
}

const { todosOsCards, reposRegistrados } = await import('../../motor/mirante/cli/dados.ts')

// O cache de todosOsCards era memoTempo puro, de 250ms, SEM chave de
// diretorio. Trocar HICODE_CARDS_DIR dentro dessa janela devolvia a lista do
// diretorio anterior. Na suite isso vira um teste lendo os cards de outro
// arquivo de teste — foi exatamente o que reprovou na CI, com o rodape
// respondendo '024' num diretorio que so tinha '020'.
test('REGRESSAO trocar o diretorio de cards invalida o cache na hora, sem esperar o TTL', () => {
  process.env.HICODE_CARDS_DIR = dirComCard('020')
  expect(todosOsCards().map(c => c.id)).toEqual(['020'])

  process.env.HICODE_CARDS_DIR = dirComCard('024')
  expect(todosOsCards().map(c => c.id), 'devolveu a lista do diretorio anterior').toEqual(['024'])

  process.env.HICODE_CARDS_DIR = dirComCard('031')
  expect(todosOsCards().map(c => c.id)).toEqual(['031'])
})

test('dentro do MESMO diretorio o cache continua valendo — a chave nao desliga o memo', () => {
  const d = dirComCard('040')
  process.env.HICODE_CARDS_DIR = d
  expect(todosOsCards().map(c => c.id)).toEqual(['040'])
  writeFileSync(join(d, '041-slug.md'), '---\nid: 041\nstatus: EXECUTING\ntitle: t\nrepo: org/app\n---\n## Objetivo\nx\n')
  expect(todosOsCards().map(c => c.id), 'o TTL de 250ms tem de continuar segurando').toEqual(['040'])
})

test('REGRESSAO o mesmo vale para o registro de repos, que tinha o mesmo defeito', () => {
  const a = mkdtempSync(join(tmpdir(), 'hii-repos-')); criados.push(a)
  const b = mkdtempSync(join(tmpdir(), 'hii-repos-')); criados.push(b)
  writeFileSync(join(a, 'repos.json'), JSON.stringify([{ name: 'org/um', path: '/tmp/um', branch: 'main' }]))
  writeFileSync(join(b, 'repos.json'), JSON.stringify([{ name: 'org/dois', path: '/tmp/dois', branch: 'main' }]))

  process.env.HICODE_REPOS_FILE = join(a, 'repos.json')
  expect(reposRegistrados().map(r => r.name)).toEqual(['org/um'])
  process.env.HICODE_REPOS_FILE = join(b, 'repos.json')
  expect(reposRegistrados().map(r => r.name)).toEqual(['org/dois'])
})
