import { TEMPO_COM_GIT_MS } from '../tempo-de-teste.ts'
import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { tocadosDoPorcelain, tocadosNoWorktree } from '../../motor/osw/executar.ts'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-tocados-'))
afterAll(() => {})

function repoNovo(nome: string): string {
  const d = join(BASE, nome)
  mkdirSync(join(d, 'ref'), { recursive: true })
  const git = (a: string[]): void => { execFileSync('git', a, { cwd: d, stdio: ['ignore', 'ignore', 'ignore'] }) }
  execFileSync('git', ['init', '-q', d])
  git(['config', 'user.email', 't@t'])
  git(['config', 'user.name', 't'])
  // Conteudo grande o bastante para o git detectar rename por similaridade.
  writeFileSync(join(d, 'ref', 'tokens.css'), ':root{--a:#111}\n'.repeat(80))
  writeFileSync(join(d, 'alvo.html'), '<p>oi</p>\n')
  git(['add', '-A'])
  git(['commit', '-qm', 'p'])
  return d
}

// `git diff --name-only HEAD` nao lista untracked, e o commit usa `git add -A`.
test('arquivo NOVO (untracked) aparece — era o furo do diff', async () => {
  const d = repoNovo('novo')
  writeFileSync(join(d, 'ref', 'criado.css'), 'x\n')
  expect(await tocadosNoWorktree(d)).toContain('ref/criado.css')
}, TEMPO_COM_GIT_MS)

test('arquivo APAGADO aparece — apagar a referencia e mexer nela', async () => {
  const d = repoNovo('apagado')
  renameSync(join(d, 'ref', 'tokens.css'), join(d, 'movido.css'))
  const t = await tocadosNoWorktree(d)
  expect(t, 'a origem tem de aparecer, senao apagar a referencia passa batido').toContain('ref/tokens.css')
}, TEMPO_COM_GIT_MS)

// A tabela do `git help status` lista R na 1a coluna ("renamed in index") E na 2a
// ("renamed in work tree"). Olhar so a primeira nao perdia apenas o campo antigo: o
// campo extra virava a "linha" seguinte, `slice(3)` cortava tres caracteres do
// caminho, e TODO o resto da saida saia deslocado — a checagem ficava cega dali para
// frente.
test('REGRESSAO: rename NAO desalinha a lista, e a origem entra', async () => {
  const d = repoNovo('rename')
  const git = (a: string[]): void => { execFileSync('git', a, { cwd: d, stdio: ['ignore', 'ignore', 'ignore'] }) }
  git(['mv', 'ref/tokens.css', 'destino.css'])
  writeFileSync(join(d, 'depois-do-rename.css'), 'y\n')
  const t = await tocadosNoWorktree(d)
  expect(t, 'o novo caminho').toContain('destino.css')
  expect(t, 'a ORIGEM do rename — sair de dentro da referencia e mexer nela').toContain('ref/tokens.css')
  expect(t, 'o arquivo seguinte na saida nao pode sair cortado').toContain('depois-do-rename.css')
  expect(t.some(c => c.startsWith('/') || c.length < 3), `nenhum caminho truncado: ${JSON.stringify(t)}`).toBe(false)
}, TEMPO_COM_GIT_MS)

test('caminho com espaco sobrevive (por isso -z, e nao o formato citado)', async () => {
  const d = repoNovo('espaco')
  writeFileSync(join(d, 'ref', 'nome com espaco.css'), 'z\n')
  expect(await tocadosNoWorktree(d)).toContain('ref/nome com espaco.css')
}, TEMPO_COM_GIT_MS)

// `stageAll` commita com `:!node_modules`. Enumerar a arvore aqui estouraria o
// maxBuffer do execFile — a checagem falharia ABERTA, em silencio, so no repo grande.
test('node_modules fica fora, igual ao que o commit de fato leva', async () => {
  const d = repoNovo('nm')
  mkdirSync(join(d, 'node_modules', 'pacote'), { recursive: true })
  writeFileSync(join(d, 'node_modules', 'pacote', 'index.js'), 'x\n')
  const t = await tocadosNoWorktree(d)
  expect(t.filter(c => c.startsWith('node_modules'))).toEqual([])
}, TEMPO_COM_GIT_MS)

// R na SEGUNDA coluna ("renamed in work tree", tabela do `git help status`) nao e
// trivial de produzir num repo de teste, mas o parse tem de aguentar: o campo extra
// que ninguem consome vira a "linha" seguinte, e dali para frente TODO caminho sai
// cortado em tres caracteres — a checagem de escopo fica cega, nao apenas incompleta.
test('REGRESSAO: R na segunda coluna nao desalinha o resto da saida', () => {
  const z = ' R alvo/tokens.css\0ref/tokens.css\0?? outro/arquivo.css\0 M terceiro.css\0'
  const t = tocadosDoPorcelain(z)
  expect(t).toEqual(['alvo/tokens.css', 'ref/tokens.css', 'outro/arquivo.css', 'terceiro.css'])
})

test('C na segunda coluna tambem consome o campo de origem', () => {
  expect(tocadosDoPorcelain(' C copia.css\0ref/base.css\0?? z.css\0')).toEqual(['copia.css', 'ref/base.css', 'z.css'])
})

test('R na primeira coluna (rename no index) continua funcionando', () => {
  expect(tocadosDoPorcelain('R  novo.css\0ref/velho.css\0 M x.css\0')).toEqual(['novo.css', 'ref/velho.css', 'x.css'])
})
