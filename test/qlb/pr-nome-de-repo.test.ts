import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nomeDeRepoValido, slugDoRemoto, slugDoGh, podeAbrirPr } from '../../motor/euc/rdr/doctor.ts'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-slug-'))
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

function cloneCom(remoto: string, nome: string): string {
  const d = join(BASE, nome)
  mkdirSync(d, { recursive: true })
  execFileSync('git', ['init', '-q', d])
  execFileSync('git', ['remote', 'add', 'origin', remoto], { cwd: d })
  return d
}

// O card 001 estava registrado como "hicode-site/" — sem owner. Rodou o pipeline
// inteiro, fez push, e morreu no `gh pr create` com "expected the [HOST/]OWNER/REPO
// format". Cada retomada refazia tudo e morria no mesmo ponto: laco que so gasta.
test('REGRESSAO: nome sem owner e reconhecido como invalido', () => {
  for (const ruim of ['hicode-site/', '', '/repo', 'so-nome', 'a/b/c/d', ' / ']) {
    expect(nomeDeRepoValido(ruim), JSON.stringify(ruim)).toBe(false)
  }
  for (const bom of ['org/repo', 'github.com/org/repo', 'rafaelvpolan/hicode-site']) {
    expect(nomeDeRepoValido(bom), bom).toBe(true)
  }
})

// O NOME e apelido local; o slug do gh vem do REMOTO. Confundir os dois foi o
// defeito — e derivar conserta o card existente sem migrar dado nenhum.
test('o slug vem do remoto quando o apelido local nao serve', () => {
  const d = cloneCom('git@github.com:rafaelvpolan/hicode-site.git', 'ssh')
  expect(slugDoRemoto(d)).toBe('rafaelvpolan/hicode-site')
  expect(slugDoGh(d, 'hicode-site/'), 'apelido ruim cede ao remoto').toBe('rafaelvpolan/hicode-site')
  expect(slugDoGh(d, 'outro/nome'), 'apelido valido manda — pode ser fork ou espelho').toBe('outro/nome')
})

test('as formas de remoto que o git usa', () => {
  // Nome do diretorio pelo INDICE: derivar do url dava colisao entre
  // "…/org/repo.git" e "…/org/repo" (mesmo prefixo), o segundo `git remote add`
  // falhava, e o teste reprovava por defeito dele mesmo.
  const casos = [
    ['git@github.com:org/repo.git', 'org/repo'],
    ['https://github.com/org/repo.git', 'org/repo'],
    ['https://github.com/org/repo', 'org/repo'],
    ['ssh://git@github.com/org/repo.git', 'org/repo'],
  ] as const
  casos.forEach(([url, esperado], i) => {
    expect(slugDoRemoto(cloneCom(url, `remoto-${i}`)), url).toBe(esperado)
  })
})

// O preflight RODAVA o comando que mataria o card, via a falha, e devolvia ok:
// `perm.ok ? ... : 'autentica sem prompt'` descartava o resultado.
test('REGRESSAO: o preflight PARA quando nao ha slug possivel, em vez de dizer ok', () => {
  const d = join(BASE, 'sem-remoto')
  mkdirSync(d, { recursive: true })
  execFileSync('git', ['init', '-q', d])
  const c = podeAbrirPr(d, 'so-apelido/')
  expect(c.severidade, 'seguir daqui gasta o pipeline inteiro para morrer no fim').toBe('erro')
  expect(c.detalhe).toContain('so-apelido/')
  expect(c.conserto, 'e tem de dizer o que fazer').toContain('repo add')
})

test('com remoto valido o preflight nao barra por causa do apelido', () => {
  const d = cloneCom('git@github.com:org/repo.git', 'ok-remoto')
  writeFileSync(join(d, 'a.txt'), 'x')
  const c = podeAbrirPr(d, 'apelido-sem-owner/')
  expect(c.detalhe, 'o apelido nao pode reprovar um caso que funcionaria').not.toContain('invalido')
})
