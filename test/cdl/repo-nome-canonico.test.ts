import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-canonico-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(join(process.env.HICODE_CARDS_DIR, 'runs'), { recursive: true })
process.env.HICODE_REPOS_FILE = join(BASE, 'repos.json')
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const { nomeCanonicoDeRepo, readCard, repoRegistered, repoPath, patchCard } = await import('../../motor/cdl/store.ts')
const { submit } = await import('../../motor/mir/acoes.ts')

// O APELIDO e um nome nao registrado; o clone irmao dele e onde `repoPath` cai.
// Registrar o projeto NESSE caminho reproduz o caso real — apelido e nome oficial
// apontando para a mesma pasta — sem depender de `HICODE_ROOT`, que e lido no
// carregamento do modulo e ja foi fixado por outro arquivo quando a suite inteira
// roda num processo so. Depender dele fazia o teste passar sozinho e falhar junto.
const APELIDO = 'projeto-do-teste-canonico'
writeFileSync(process.env.HICODE_REPOS_FILE, JSON.stringify([{ name: 'dono/projeto', path: repoPath(APELIDO), branch: 'main' }]))


// Um projeto, um NOME. O registro trocou `hicode-site/` por
// `rafaelvpolan/hicode-site`, a sessao da TUI aberta continuou com o nome velho, e
// os cards criados depois nasceram presos a ele — `repoRegistered` false, mas
// `repoPath` resolvendo para a MESMA pasta. O projeto aparecia duas vezes.
test('REGRESSAO: apelido que aponta para o mesmo clone vira o nome REGISTRADO', () => {
  expect(repoRegistered(APELIDO), 'o apelido nao esta no registro').toBe(false)
  expect(nomeCanonicoDeRepo(APELIDO), 'mas resolve para o mesmo clone').toBe('dono/projeto')
  expect(nomeCanonicoDeRepo('dono/projeto'), 'nome ja canonico nao muda').toBe('dono/projeto')
})

test('projeto DESCONHECIDO nao e sequestrado por outro registro', () => {
  expect(nomeCanonicoDeRepo('outra/coisa'), 'clone diferente, nome diferente').toBe('outra/coisa')
  expect(nomeCanonicoDeRepo(''), 'vazio segue vazio').toBe('')
})

test('REGRESSAO: card criado com apelido nasce com o nome canonico', () => {
  const id = submit({ title: 'tarefa nova', repo: APELIDO })
  expect(readCard(id)?.fm.repo, 'senao a TUI mostra o mesmo projeto duas vezes').toBe('dono/projeto')
})

// A remocao resolvia o alvo por nome EXATO no registro: card com repo nao registrado
// deixava o worktree no disco PARA SEMPRE, e ainda reportava sucesso.
test('REGRESSAO: remover card com repo nao registrado nao perde o worktree em silencio', async () => {
  const { remover } = await import('../../motor/cdl/remover.ts')
  const wt = join(BASE, 'worktree-do-card')
  mkdirSync(wt, { recursive: true })
  const id = submit({ title: 'com worktree', repo: APELIDO })
  patchCard(id, { worktree: wt, status: 'HALTED' })
  const r = await remover(id, true)
  expect(r.ok).toBe(true)
  const disse = r.limpou.join(' ')
  expect(disse.includes('worktree removido') || disse.includes('ATENCAO'), `nao pode calar: ${disse}`).toBe(true)
})
