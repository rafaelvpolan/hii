import { test, expect, afterAll, qualBinario } from '../apoio/runner.ts'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Canal de leitura: /hii-review, /hii-review-pr e /hii-plan chegam pela conversa
// (responderPergunta) e rodam na IA de verify com as instrucoes da pasta do
// Claude. O motor monta o contexto (diff do alvo ou do PR) so com git/gh de
// leitura, para nas paradas sem chamar a IA e nunca publica nada no GitHub.
//
// claude, gh, git e codex sao falsos no PATH: gravam o que receberam. O git falso
// executa o git real (caminho resolvido ANTES de trocar o PATH).

const TEMPO_MS = 60_000
const BASE = realpathSync(mkdtempSync(join(tmpdir(), 'hii-leitura-')))
const BIN = join(BASE, 'bin')
const ARGV_CLAUDE = join(BASE, 'claude-argv.txt')
const CWD_CLAUDE = join(BASE, 'claude-cwd.txt')
const STDIN_CLAUDE = join(BASE, 'claude-stdin.txt')
const LOG_GH = join(BASE, 'gh.log')
const LOG_GIT = join(BASE, 'git.log')
const CODEX_CHAMADO = join(BASE, 'codex.txt')
mkdirSync(BIN, { recursive: true })

const GIT_REAL = qualBinario('git')
if (!GIT_REAL) throw new Error('git real nao encontrado no PATH')

const FAKE_CLAUDE = `#!/usr/bin/env bash
: > "$LEITURA_CLAUDE_ARGV"
for a in "$@"; do printf '%s\\0' "$a" >> "$LEITURA_CLAUDE_ARGV"; done
pwd -P > "$LEITURA_CLAUDE_CWD"
cat > "$LEITURA_CLAUDE_STDIN" 2>/dev/null || true
echo '{"result":"ok"}'
`

const FAKE_GH = `#!/usr/bin/env bash
{ printf '%s\\037' "\${GH_PROMPT_DISABLED-AUSENTE}" "$@"; printf '\\n'; } >> "$LEITURA_GH_LOG"
if [ "$GH_FALSO_ESTADO" = "FALHA" ]; then
  echo "To get started with GitHub CLI, please run:  gh auth login" >&2
  exit 4
fi
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  ESTADO=OPEN; DRAFT=false; DECISAO=REVIEW_REQUIRED; REVISOES='[]'
  case "$GH_FALSO_ESTADO" in
    CLOSED) ESTADO=CLOSED ;;
    MERGED) ESTADO=MERGED ;;
    DRAFT) DRAFT=true ;;
    APROVADO) DECISAO=APPROVED; REVISOES='[{"author":{"login":"ana"},"state":"APPROVED"},{"author":{"login":"bia"},"state":"APPROVED"}]' ;;
    ILEGIVEL) echo 'isto nao e json'; exit 0 ;;
  esac
  printf '{"number":7,"title":"PR falso","body":"Objetivo: corpo-do-pr-falso-5d8","url":"https://github.com/org/app/pull/7","state":"%s","isDraft":%s,"reviewDecision":"%s","latestReviews":%s,"headRefName":"feat/falso","baseRefName":"main","author":{"login":"autor"}}\\n' "$ESTADO" "$DRAFT" "$DECISAO" "$REVISOES"
  exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "diff" ]; then
  cat <<'FIM'
diff --git a/src/pr-falso.ts b/src/pr-falso.ts
index 1111111..2222222 100644
--- a/src/pr-falso.ts
+++ b/src/pr-falso.ts
@@ -1 +1 @@
-export const pr = 1
+export const pr = 2 // linha-do-pr-falso-9c1
FIM
  exit 0
fi
exit 0
`

const FAKE_GIT = `#!/usr/bin/env bash
{ printf '%s\\037' "\${GIT_OPTIONAL_LOCKS-AUSENTE}" "$@"; printf '\\n'; } >> "$LEITURA_GIT_LOG"
if [ -n "$GIT_FALSO_FALHAR" ]; then
  for a in "$@"; do
    if [ "$a" = "diff" ]; then echo "fatal: erro simulado do git" >&2; exit 128; fi
  done
fi
exec "$LEITURA_GIT_REAL" "$@"
`

const FAKE_CODEX = `#!/usr/bin/env bash
echo chamado >> "$LEITURA_CODEX_CHAMADO"
exit 0
`

for (const [nome, corpo] of [['claude', FAKE_CLAUDE], ['gh', FAKE_GH], ['git', FAKE_GIT], ['codex', FAKE_CODEX]] as const) {
  writeFileSync(join(BIN, nome), corpo)
  chmodSync(join(BIN, nome), 0o755)
}

// --- repositorios de fixture (com o git REAL, fora do log) ---

function git(cwd: string, ...args: string[]): void {
  execFileSync(GIT_REAL ?? 'git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, stdio: 'ignore' })
}

function repoComCommit(nome: string, arquivo: string, conteudo: string): string {
  const d = join(BASE, nome)
  mkdirSync(join(d, 'src'), { recursive: true })
  git(d, 'init', '-q')
  writeFileSync(join(d, arquivo), conteudo)
  git(d, 'add', '-A')
  git(d, 'commit', '-qm', 'fixture')
  return d
}

const LINHA_ALTERADA = 'linha-alterada-unica-7f3'
const ALVO = repoComCommit('alvo', 'src/app.ts', 'export const valor = 1\n')
writeFileSync(join(ALVO, 'src', 'app.ts'), `export const valor = 2 // ${LINHA_ALTERADA}\n`)
writeFileSync(join(ALVO, 'novo-nao-rastreado.ts'), 'export const novo = true\n')

const LIMPO = repoComCommit('limpo', 'src/app.ts', 'export const valor = 1\n')

const GRANDE = repoComCommit('grande', 'grande.txt', 'a\n')
writeFileSync(join(GRANDE, 'grande.txt'), Array.from({ length: 500 }, (_, i) => `linha ${i} ${'x'.repeat(90)}`).join('\n') + '\n')

const FORA = join(BASE, 'fora-do-git')
mkdirSync(FORA, { recursive: true })
const SUB = join(ALVO, 'src')

// Arvore limpa com a branch a frente da base: o diff sai de <base>...HEAD. Um
// fixture por origem da base, na ordem em que o motor tenta: @{u}, origin/HEAD,
// main, master. Nenhum tem upstream nem remoto alem do que a origem pede.

function commitar(d: string, arquivo: string, conteudo: string, mensagem: string): void {
  writeFileSync(join(d, arquivo), conteudo)
  git(d, 'add', '-A')
  git(d, 'commit', '-qm', mensagem)
}

function repoNaBranch(nome: string, branch: string): string {
  const d = join(BASE, nome)
  mkdirSync(join(d, 'src'), { recursive: true })
  git(d, 'init', '-q')
  git(d, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`)
  commitar(d, 'src/app.ts', 'export const valor = 1\n', 'base')
  return d
}

// main: a base avanca depois do corte; com `..` em vez de `...` a linha so da base
// entraria no diff como removida.
const LINHA_SO_NA_BASE = 'linha-so-na-base-main-b71'
const LINHA_A_FRENTE_DE_MAIN = 'linha-a-frente-de-main-3a9'
const A_FRENTE_DE_MAIN = repoNaBranch('a-frente-de-main', 'main')
git(A_FRENTE_DE_MAIN, 'checkout', '-q', '--no-track', '-b', 'feat/a-frente')
commitar(A_FRENTE_DE_MAIN, 'src/app.ts', `export const valor = 3 // ${LINHA_A_FRENTE_DE_MAIN}\n`, 'commit da branch')
git(A_FRENTE_DE_MAIN, 'checkout', '-q', 'main')
commitar(A_FRENTE_DE_MAIN, 'src/base.ts', `export const base = 1 // ${LINHA_SO_NA_BASE}\n`, 'base avancou')
git(A_FRENTE_DE_MAIN, 'checkout', '-q', 'feat/a-frente')

const LINHA_A_FRENTE_DE_MASTER = 'linha-a-frente-de-master-c40'
const A_FRENTE_DE_MASTER = repoNaBranch('a-frente-de-master', 'master')
git(A_FRENTE_DE_MASTER, 'checkout', '-q', '--no-track', '-b', 'feat/a-frente')
commitar(A_FRENTE_DE_MASTER, 'src/app.ts', `export const valor = 3 // ${LINHA_A_FRENTE_DE_MASTER}\n`, 'commit da branch')

// @{u}: o upstream (rastreio) ja tem um commit alem de main; so o commit da
// branch sobre o upstream entra no diff.
const LINHA_DO_RASTREIO = 'linha-do-rastreio-e22'
const LINHA_A_FRENTE_DO_UPSTREAM = 'linha-a-frente-do-upstream-6d1'
const A_FRENTE_DO_UPSTREAM = repoNaBranch('a-frente-do-upstream', 'main')
git(A_FRENTE_DO_UPSTREAM, 'checkout', '-q', '-b', 'rastreio')
commitar(A_FRENTE_DO_UPSTREAM, 'src/rastreio.ts', `export const r = 1 // ${LINHA_DO_RASTREIO}\n`, 'commit do upstream')
git(A_FRENTE_DO_UPSTREAM, 'checkout', '-q', '-b', 'feat/a-frente')
git(A_FRENTE_DO_UPSTREAM, 'branch', '-q', '--set-upstream-to=rastreio')
commitar(A_FRENTE_DO_UPSTREAM, 'src/app.ts', `export const valor = 3 // ${LINHA_A_FRENTE_DO_UPSTREAM}\n`, 'commit da branch')

// origin/HEAD: clone de uma origem local; a branch nova nao rastreia nada.
const LINHA_A_FRENTE_DA_ORIGEM = 'linha-a-frente-da-origem-91f'
const ORIGEM = repoNaBranch('origem', 'main')
const A_FRENTE_DA_ORIGEM = join(BASE, 'a-frente-da-origem')
git(BASE, 'clone', '-q', ORIGEM, A_FRENTE_DA_ORIGEM)
git(A_FRENTE_DA_ORIGEM, 'checkout', '-q', '--no-track', '-b', 'feat/a-frente')
commitar(A_FRENTE_DA_ORIGEM, 'src/app.ts', `export const valor = 3 // ${LINHA_A_FRENTE_DA_ORIGEM}\n`, 'commit da branch')

// --- ambiente: tudo isolado antes do import dinamico ---

const ENV_ANTES: Record<string, string | undefined> = {}
function fixar(chave: string, valor: string): void {
  if (!(chave in ENV_ANTES)) ENV_ANTES[chave] = process.env[chave]
  process.env[chave] = valor
}

fixar('HII_CARDS_DIR', join(BASE, 'cards'))
mkdirSync(join(BASE, 'cards'), { recursive: true })
fixar('HII_REPOS_FILE', join(BASE, 'repos.json'))
writeFileSync(join(BASE, 'repos.json'), '[]')
fixar('HII_CLAUDE_CONFIG', join(BASE, 'claude-config-inexistente.json'))
fixar('HII_CLAUDE_HOME_DIR', join(BASE, 'home-claude'))
fixar('HII_PROJECT_MEMORY', 'off')
fixar('HII_VERIFY_PROVIDER', 'claude')
fixar('HII_IMPLEMENT_PROVIDER', 'claude')
fixar('LEITURA_CLAUDE_ARGV', ARGV_CLAUDE)
fixar('LEITURA_CLAUDE_CWD', CWD_CLAUDE)
fixar('LEITURA_CLAUDE_STDIN', STDIN_CLAUDE)
fixar('LEITURA_GH_LOG', LOG_GH)
fixar('LEITURA_GIT_LOG', LOG_GIT)
fixar('LEITURA_GIT_REAL', GIT_REAL)
fixar('LEITURA_CODEX_CHAMADO', CODEX_CHAMADO)
fixar('GH_FALSO_ESTADO', 'OPEN')
fixar('PATH', `${BIN}:${process.env.PATH ?? ''}`)
delete process.env.GIT_FALSO_FALHAR
delete process.env.HII_AI_PROVIDER

afterAll(() => {
  for (const [chave, valor] of Object.entries(ENV_ANTES)) {
    if (valor === undefined) delete process.env[chave]
    else process.env[chave] = valor
  }
  delete process.env.GIT_FALSO_FALHAR
  rmSync(BASE, { recursive: true, force: true })
})

const { responderPergunta, promptDoComandoDeLeitura } = await import('../../motor/quilombo/cartorio/responder-pergunta.ts')
const { prepararComandoDeLeitura } = await import('../../motor/quilombo/cartorio/comando-de-leitura.ts')
const { PASTA_DO_CLAUDE } = await import('../../motor/tomada/harness/pasta-do-claude.ts')
const { ROOT, GATE_TIMEOUT_MIN_MS } = await import('../../motor/cordel/alicerce/config.ts')
const { timeoutForDiff } = await import('../../motor/ciclo/crivo/gate.ts')

// --- leitura do que os falsos gravaram ---

interface Chamada {
  env: string
  args: string[]
}

function chamadas(arquivo: string): Chamada[] {
  if (!existsSync(arquivo)) return []
  return readFileSync(arquivo, 'utf8').split('\n').filter(l => l.length > 0).map(l => {
    const partes = l.split('\x1f')
    partes.pop()
    return { env: partes[0] ?? '', args: partes.slice(1) }
  })
}

function subcomandoDoGit(args: string[]): string {
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? ''
    if (a === '-C' || a === '-c') { i++; continue }
    if (a.startsWith('-')) continue
    return a
  }
  return ''
}

function limpar(): void {
  for (const f of [ARGV_CLAUDE, CWD_CLAUDE, STDIN_CLAUDE, LOG_GH, LOG_GIT, CODEX_CHAMADO]) rmSync(f, { force: true })
}

function claudeChamado(): boolean {
  return existsSync(ARGV_CLAUDE)
}

function promptDoClaude(): string {
  const a = existsSync(ARGV_CLAUDE) ? readFileSync(ARGV_CLAUDE, 'utf8').split('\0') : []
  const i = a.indexOf('-p')
  const pelaLinha = i >= 0 ? (a[i + 1] ?? '') : ''
  const pelaEntrada = existsSync(STDIN_CLAUDE) ? readFileSync(STDIN_CLAUDE, 'utf8') : ''
  return pelaLinha || pelaEntrada
}

function cwdDoClaude(): string {
  return existsSync(CWD_CLAUDE) ? readFileSync(CWD_CLAUDE, 'utf8').trim() : ''
}

function instrucoesDaPasta(nome: string): string {
  const texto = readFileSync(join(PASTA_DO_CLAUDE, 'comandos', `${nome}.md`), 'utf8').replace(/\r/g, '')
  const m = texto.match(/^---\n([\s\S]*?)\n---/)
  return (m ? texto.slice((m.index ?? 0) + m[0].length) : texto).trim()
}

async function comEnv<T>(valores: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const antes: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(valores)) {
    antes[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    return await fn()
  } finally {
    for (const [k, v] of Object.entries(antes)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

async function paradaDe(pergunta: string, alvo: string): Promise<string> {
  const p = await prepararComandoDeLeitura(pergunta, alvo)
  expect(p, `${pergunta} @ ${alvo}`).not.toBeNull()
  return p?.parada ?? ''
}

// Parada na TUI: texto da parada, custo zero medido, IA nao chamada. Bloqueio
// legitimo sai ok; falha de git/gh sai com ok false, nunca como sucesso.
async function afirmarParadaSemIa(pergunta: string, alvo: string, rotulo: string, falhou = false): Promise<string> {
  limpar()
  const preparo = await prepararComandoDeLeitura(pergunta, alvo)
  expect(preparo, rotulo).not.toBeNull()
  const parada = preparo?.parada ?? ''
  expect(parada.trim().length, rotulo).toBeGreaterThan(0)
  expect(preparo?.falhou, rotulo).toBe(falhou)
  const r = await responderPergunta(pergunta, alvo)
  expect(claudeChamado(), rotulo).toBe(false)
  expect(existsSync(CODEX_CHAMADO), rotulo).toBe(false)
  expect(r.texto.trim(), rotulo).toBe(parada.trim())
  expect(r.ok, rotulo).toBe(!falhou)
  expect(r.custo, rotulo).toBe(0)
  expect(r.custoMedido, rotulo).toBe(true)
  return parada
}

function ghNuncaPublicou(rotulo: string): void {
  for (const c of chamadas(LOG_GH)) {
    const [a0, a1] = c.args
    expect(a0, rotulo).not.toBe('api')
    if (a0 === 'pr') {
      for (const proibido of ['review', 'comment', 'merge', 'edit', 'close', 'ready']) expect(a1, rotulo).not.toBe(proibido)
    }
  }
}

// --- /hii-review ---

test('comandos-de-leitura: prompt contem a linha do diff — /hii-review chama o claude com as instrucoes da pasta, o arquivo e a linha alterada, sem "no maximo 12 linhas"', async () => {
  const preparo = await prepararComandoDeLeitura('/hii-review', ALVO)
  if (!preparo) throw new Error('/hii-review nao foi reconhecido')
  limpar()
  const r = await responderPergunta('/hii-review', ALVO)
  expect(claudeChamado()).toBe(true)
  const prompt = promptDoClaude()
  // O mesmo texto que a API monta (promptDoComandoDeLeitura), sem conversa.
  expect(prompt).toContain(promptDoComandoDeLeitura(preparo, '/hii-review', ALVO))
  expect(prompt).toContain(instrucoesDaPasta('hii-review'))
  expect(prompt).toContain('src/app.ts')
  expect(prompt).toContain(LINHA_ALTERADA)
  expect(prompt).toContain('novo-nao-rastreado.ts')
  expect(prompt).not.toContain('no maximo 12 linhas')
  expect(r.ok).toBe(true)
  expect(r.texto).toBe('ok')
  expect(r.provedor).toBe('claude')
}, TEMPO_MS)

test('comandos-de-leitura: cwd do claude = alvo no comando de leitura', async () => {
  limpar()
  await responderPergunta('/hii-review', ALVO)
  expect(claudeChamado()).toBe(true)
  expect(cwdDoClaude()).toBe(ALVO)
  expect(cwdDoClaude()).not.toBe(realpathSync(ROOT))
}, TEMPO_MS)

test('comandos-de-leitura: git com GIT_OPTIONAL_LOCKS=0 e so leitura (rev-parse, diff, ls-files)', async () => {
  limpar()
  await responderPergunta('/hii-review', ALVO)
  const feitas = chamadas(LOG_GIT)
  expect(feitas.length).toBeGreaterThan(0)
  expect(feitas.map(c => subcomandoDoGit(c.args))).toContain('diff')
  for (const c of feitas) {
    const rotulo = c.args.join(' ')
    expect(c.env, rotulo).toBe('0')
    expect(['rev-parse', 'diff', 'ls-files'], rotulo).toContain(subcomandoDoGit(c.args))
    expect(c.args, rotulo).not.toContain('fetch')
  }
}, TEMPO_MS)

test('comandos-de-leitura: falha de git ≠ nada a revisar — paradas distintas, so a falha sai com ok false, e a IA nao e chamada', async () => {
  const nadaARevisar = await afirmarParadaSemIa('/hii-review', LIMPO, 'diff vazio')
  const falhaDeGit = await comEnv({ GIT_FALSO_FALHAR: '1' }, () => afirmarParadaSemIa('/hii-review', ALVO, 'git falhou', true))
  expect(falhaDeGit).not.toBe(nadaARevisar)
  expect(falhaDeGit.toLowerCase()).toContain('git')
}, TEMPO_MS)

test('comandos-de-leitura: gh falha → parada com ok false, distinta de falha de git e de diff vazio, sem chamar a IA', async () => {
  const doGh = await comEnv({ GH_FALSO_ESTADO: 'FALHA' }, () => afirmarParadaSemIa('/hii-review-pr 7', ALVO, 'gh sem auth', true))
  const nadaARevisar = await paradaDe('/hii-review', LIMPO)
  const falhaDeGit = await comEnv({ GIT_FALSO_FALHAR: '1' }, () => paradaDe('/hii-review', ALVO))
  expect(new Set([doGh, nadaARevisar, falhaDeGit]).size).toBe(3)
  ghNuncaPublicou('gh falha')
}, TEMPO_MS)

test('comandos-de-leitura: gh com dados ilegiveis e falha, nao bloqueio — ok false e a IA nao e chamada', async () => {
  const parada = await comEnv({ GH_FALSO_ESTADO: 'ILEGIVEL' }, () => afirmarParadaSemIa('/hii-review-pr 7', ALVO, 'gh ilegivel', true))
  expect(parada).toContain('ilegiveis')
  ghNuncaPublicou('gh ilegivel')
}, TEMPO_MS)

// --- /hii-review com a arvore limpa e a branch a frente da base ---

const ORIGENS_DA_BASE = [
  { base: '@{u}', alvo: A_FRENTE_DO_UPSTREAM, linha: LINHA_A_FRENTE_DO_UPSTREAM, fora: LINHA_DO_RASTREIO, tentadas: ['@{u}'] },
  { base: 'origin/HEAD', alvo: A_FRENTE_DA_ORIGEM, linha: LINHA_A_FRENTE_DA_ORIGEM, fora: '', tentadas: ['@{u}', 'origin/HEAD'] },
  { base: 'main', alvo: A_FRENTE_DE_MAIN, linha: LINHA_A_FRENTE_DE_MAIN, fora: LINHA_SO_NA_BASE, tentadas: ['@{u}', 'origin/HEAD', 'main'] },
  { base: 'master', alvo: A_FRENTE_DE_MASTER, linha: LINHA_A_FRENTE_DE_MASTER, fora: '', tentadas: ['@{u}', 'origin/HEAD', 'main', 'master'] },
]

for (const o of ORIGENS_DA_BASE) {
  test(`comandos-de-leitura: arvore limpa com branch a frente de ${o.base} — git registra diff ${o.base}...HEAD, o prompt leva o commit da branch e o claude e chamado`, async () => {
    limpar()
    const r = await responderPergunta('/hii-review', o.alvo)
    expect(claudeChamado()).toBe(true)
    expect(r.ok).toBe(true)
    const prompt = promptDoClaude()
    expect(prompt).toContain(`DIFF (${o.base}...HEAD):`)
    expect(prompt).toContain(o.linha)
    if (o.fora) expect(prompt).not.toContain(o.fora)

    const feitas = chamadas(LOG_GIT)
    const tentadas = feitas
      .filter(c => subcomandoDoGit(c.args) === 'rev-parse' && c.args.includes('--verify'))
      .map(c => (c.args[c.args.length - 1] ?? '').replace(/\^\{commit\}$/, ''))
    expect(tentadas).toEqual(o.tentadas)
    const diffs = feitas.filter(c => subcomandoDoGit(c.args) === 'diff').map(c => c.args)
    expect(diffs).toEqual([
      ['diff', '--no-color', '--no-ext-diff', 'HEAD'],
      ['diff', '--no-color', '--no-ext-diff', `${o.base}...HEAD`],
    ])
  }, TEMPO_MS)
}

// --- /hii-review-pr ---

test('comandos-de-leitura: hii-review-pr com PR fechado, rascunho, mergeado ou aprovado explica o portao e NAO chama o claude', async () => {
  for (const estado of ['CLOSED', 'DRAFT', 'MERGED', 'APROVADO']) {
    const texto = await comEnv({ GH_FALSO_ESTADO: estado }, () => afirmarParadaSemIa('/hii-review-pr 7', ALVO, estado))
    expect(texto, estado).not.toBe('ok')
    expect(chamadas(LOG_GH).some(c => c.args[0] === 'pr' && c.args[1] === 'view'), estado).toBe(true)
    ghNuncaPublicou(estado)
  }
}, TEMPO_MS)

test('comandos-de-leitura: hii-review-pr 7 com PR aberto poe o corpo do PR, a saida de gh pr diff 7 e as instrucoes da pasta no prompt', async () => {
  limpar()
  const r = await comEnv({ GH_FALSO_ESTADO: 'OPEN' }, () => responderPergunta('/hii-review-pr 7', ALVO))
  expect(claudeChamado()).toBe(true)
  const prompt = promptDoClaude()
  // A IA de leitura nao tem gh: o objetivo do PR so chega pelo corpo anexado.
  expect(prompt).toContain('CORPO DO PR:\nObjetivo: corpo-do-pr-falso-5d8')
  const visao = chamadas(LOG_GH).find(c => c.args[0] === 'pr' && c.args[1] === 'view')
  expect((visao?.args[4] ?? '').split(',')).toContain('body')
  expect(prompt).toContain('src/pr-falso.ts')
  expect(prompt).toContain('linha-do-pr-falso-9c1')
  expect(prompt).toContain(instrucoesDaPasta('hii-review-pr'))
  expect(prompt).not.toContain('no maximo 12 linhas')
  expect(r.texto).toBe('ok')
}, TEMPO_MS)

test('comandos-de-leitura: nunca pr review/comment/merge/api — gh so recebe pr view N --json e pr diff N, com GH_PROMPT_DISABLED=1', async () => {
  limpar()
  for (const estado of ['OPEN', 'CLOSED', 'DRAFT', 'MERGED', 'APROVADO', 'FALHA', 'ILEGIVEL']) {
    await comEnv({ GH_FALSO_ESTADO: estado }, () => responderPergunta('/hii-review-pr 7', ALVO))
  }
  const feitas = chamadas(LOG_GH)
  expect(feitas.length).toBeGreaterThan(0)
  ghNuncaPublicou('todos os estados')
  for (const c of feitas) {
    const rotulo = c.args.join(' ')
    expect(c.env, rotulo).toBe('1')
    const visao = c.args.length === 5 && c.args[0] === 'pr' && c.args[1] === 'view' && c.args[2] === '7' && c.args[3] === '--json'
    const diff = c.args.length === 3 && c.args[0] === 'pr' && c.args[1] === 'diff' && c.args[2] === '7'
    expect(visao || diff, rotulo).toBe(true)
  }
  expect(feitas.some(c => c.args[1] === 'diff')).toBe(true)
}, TEMPO_MS)

test('comandos-de-leitura: numero de PR invalido vira parada de uso, sem gh e sem IA', async () => {
  for (const pergunta of ['/hii-review-pr', '/hii-review-pr abc', '/hii-review-pr 0', '/hii-review-pr -1', '/hii-review-pr 1.5', '/hii-review-pr 7;rm', '/hii-review-pr 99999999999999999999']) {
    await afirmarParadaSemIa(pergunta, ALVO, pergunta)
    expect(chamadas(LOG_GH), pergunta).toEqual([])
  }
}, TEMPO_MS)

// --- /hii-plan e tempo ---

test('comandos-de-leitura: /hii-plan poe no prompt as instrucoes do comando hii-plan, sem diff', async () => {
  limpar()
  await responderPergunta('/hii-plan desenhar o modulo de caixa', ALVO)
  expect(claudeChamado()).toBe(true)
  const prompt = promptDoClaude()
  expect(prompt).toContain(instrucoesDaPasta('hii-plan'))
  expect(prompt).toContain('desenhar o modulo de caixa')
  expect(prompt).not.toContain(LINHA_ALTERADA)
  expect(chamadas(LOG_GH)).toEqual([])
  expect(chamadas(LOG_GIT).map(c => subcomandoDoGit(c.args))).not.toContain('diff')
}, TEMPO_MS)

test('comandos-de-leitura: hii-plan sem contexto usa o tempo minimo do gate; hii-review com diff grande usa mais', async () => {
  // O minimo vem da config do gate, nao da formula que a implementacao usa.
  const minimo = GATE_TIMEOUT_MIN_MS
  const plano = await prepararComandoDeLeitura('/hii-plan desenhar o modulo', ALVO)
  expect(plano).not.toBeNull()
  expect(plano?.parada).toBeUndefined()
  expect(plano?.contexto).toBe('')
  expect(plano?.timeoutMs).toBe(minimo)

  const revisao = await prepararComandoDeLeitura('/hii-review', GRANDE)
  expect(revisao).not.toBeNull()
  expect(revisao?.parada).toBeUndefined()
  expect((revisao?.contexto ?? '').length).toBeGreaterThan(1024)
  expect(revisao?.timeoutMs).toBe(timeoutForDiff({ names: '', patch: revisao?.contexto ?? '' }))
  expect(revisao?.timeoutMs ?? 0).toBeGreaterThan(minimo)
}, TEMPO_MS)

// --- pergunta comum (garantias da base) ---

test('garantia: pergunta comum com "no maximo 12 linhas"', async () => {
  limpar()
  await responderPergunta('qual a stack deste projeto?', ALVO)
  expect(claudeChamado()).toBe(true)
  const prompt = promptDoClaude()
  expect(prompt).toContain('no maximo 12 linhas')
  expect(prompt).toContain('PERGUNTA: qual a stack deste projeto?')
  expect(prompt).not.toContain(instrucoesDaPasta('hii-review'))
}, TEMPO_MS)

test('comandos-de-leitura: pergunta comum mantém cwd ROOT', async () => {
  limpar()
  await responderPergunta('qual a stack deste projeto?', ALVO)
  expect(claudeChamado()).toBe(true)
  expect(cwdDoClaude()).toBe(realpathSync(ROOT))
}, TEMPO_MS)

test('comandos-de-leitura: so o primeiro token ativa comando — "o que faz /hii-review?" e pergunta comum', async () => {
  expect(await prepararComandoDeLeitura('o que faz /hii-review?', ALVO)).toBeNull()
  expect(await prepararComandoDeLeitura('qual a stack deste projeto?', ALVO)).toBeNull()
  expect(await prepararComandoDeLeitura('/hii-refinar organizar', ALVO)).toBeNull()
  limpar()
  await responderPergunta('o que faz /hii-review?', ALVO)
  expect(claudeChamado()).toBe(true)
  const prompt = promptDoClaude()
  expect(prompt).toContain('no maximo 12 linhas')
  expect(prompt).not.toContain(LINHA_ALTERADA)
  expect(cwdDoClaude()).toBe(realpathSync(ROOT))
  expect(chamadas(LOG_GIT).map(c => subcomandoDoGit(c.args))).not.toContain('diff')
}, TEMPO_MS)

// --- provedor de verify e alvo ---

test('comandos-de-leitura: provedor divergente → parada — verify=codex explica qual IA esta em verify, sem chamar IA', async () => {
  const parada = await comEnv({ HII_VERIFY_PROVIDER: 'codex' }, () => afirmarParadaSemIa('/hii-review', ALVO, 'verify codex'))
  expect(parada).toContain('codex')
}, TEMPO_MS)

test('comandos-de-leitura: implement codex com verify claude prepara e chama o claude com o diff', async () => {
  await comEnv({ HII_IMPLEMENT_PROVIDER: 'codex', HII_VERIFY_PROVIDER: 'claude' }, async () => {
    const p = await prepararComandoDeLeitura('/hii-review', ALVO)
    expect(p).not.toBeNull()
    expect(p?.parada).toBeUndefined()
    expect(p?.instrucoes).toBe(instrucoesDaPasta('hii-review'))
    expect(p?.contexto ?? '').toContain(LINHA_ALTERADA)
    limpar()
    await responderPergunta('/hii-review', ALVO)
    expect(claudeChamado()).toBe(true)
    expect(existsSync(CODEX_CHAMADO)).toBe(false)
    expect(promptDoClaude()).toContain(instrucoesDaPasta('hii-review'))
    expect(promptDoClaude()).toContain(LINHA_ALTERADA)
  })
}, TEMPO_MS)

test('comandos-de-leitura: verify claude-ollama prepara o comando', async () => {
  const p = await comEnv({ HII_VERIFY_PROVIDER: 'claude-ollama' }, () => prepararComandoDeLeitura('/hii-review', ALVO))
  expect(p).not.toBeNull()
  expect(p?.parada).toBeUndefined()
  expect(p?.instrucoes).toBe(instrucoesDaPasta('hii-review'))
  expect(p?.contexto ?? '').toContain(LINHA_ALTERADA)
}, TEMPO_MS)

test('comandos-de-leitura: alvo fora da raiz → parada sem projeto (vazio, inexistente, fora do git, subdiretorio)', async () => {
  for (const [rotulo, alvo] of [['vazio', ''], ['inexistente', join(BASE, 'nao-existe')], ['fora do git', FORA], ['subdiretorio do repo', SUB]] as const) {
    await afirmarParadaSemIa('/hii-review', alvo, rotulo)
    expect(chamadas(LOG_GIT).map(c => subcomandoDoGit(c.args)), rotulo).not.toContain('diff')
  }
}, TEMPO_MS)
