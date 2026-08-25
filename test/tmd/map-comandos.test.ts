import { test, expect, beforeEach, afterEach } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let home = ''
let repoDir = ''
const antigo: Record<string, string | undefined> = {}

function guardar(chave: string, valor: string | undefined): void {
  antigo[chave] = process.env[chave]
  if (valor === undefined) delete process.env[chave]
  else process.env[chave] = valor
}

function skill(dir: string, nome: string, descricao: string): void {
  const alvo = join(dir, nome)
  mkdirSync(alvo, { recursive: true })
  writeFileSync(join(alvo, 'SKILL.md'), `---\nname: ${nome}\ndescription: "${descricao}"\n---\ncorpo\n`)
}

function comando(dir: string, nome: string, descricao: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${nome}.md`), `---\ndescription: "${descricao}"\n---\ncorpo\n`)
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'hii-home-'))
  repoDir = mkdtempSync(join(tmpdir(), 'hii-repo-'))
  guardar('HOME', home)
  guardar('CODEX_HOME', undefined)
  guardar('HICODE_CLAUDE_HOME_DIR', join(home, '.claude'))
  guardar('HICODE_KIMI_HOME_DIR', join(home, '.kimi-code'))
  guardar('HICODE_IA_FILE', join(home, 'sem-preferencias.json'))
  guardar('HICODE_IMPLEMENT_PROVIDER', undefined)
})

afterEach(() => {
  for (const [chave, valor] of Object.entries(antigo)) {
    if (valor === undefined) delete process.env[chave]
    else process.env[chave] = valor
  }
  rmSync(home, { recursive: true, force: true })
  rmSync(repoDir, { recursive: true, force: true })
})

test('claude: junta comandos do usuario, do projeto e as skills do projeto', async () => {
  comando(join(home, '.claude', 'commands'), 'foo', 'comando global')
  comando(join(repoDir, '.claude', 'commands'), 'bar', 'comando do projeto')
  skill(join(repoDir, '.claude', 'skills'), 'baz', 'skill do projeto')
  process.env.HICODE_IMPLEMENT_PROVIDER = 'claude'
  const { comandosDaIaAtiva } = await import('../../motor/tmd/map/comandos.ts')
  const r = comandosDaIaAtiva(repoDir)
  expect(r.provedor).toBe('claude')
  expect(r.comandos.map(c => c.comando).sort()).toEqual(['/bar', '/baz', '/foo'])
  expect(r.comandos.find(c => c.comando === '/foo')?.descricao).toBe('comando global')
})

test('codex: descobre as skills do CODEX_HOME e do projeto', async () => {
  process.env.CODEX_HOME = join(home, '.codex-custom')
  skill(join(home, '.codex-custom', 'skills'), 'imagegen', 'gera imagem')
  skill(join(repoDir, '.codex', 'skills'), 'openai-docs', 'docs')
  process.env.HICODE_IMPLEMENT_PROVIDER = 'codex'
  const { comandosDaIaAtiva } = await import('../../motor/tmd/map/comandos.ts')
  const r = comandosDaIaAtiva(repoDir)
  expect(r.provedor).toBe('codex')
  expect(r.comandos.map(c => c.comando).sort()).toEqual(['/imagegen', '/openai-docs'])
})

test('kimi: descobre as skills do usuario e do projeto', async () => {
  skill(join(home, '.kimi-code', 'skills'), 'planeja', 'planeja tarefas')
  skill(join(repoDir, '.kimi-code', 'skills'), 'revisa', 'revisa PR')
  process.env.HICODE_IMPLEMENT_PROVIDER = 'kimi'
  const { comandosDaIaAtiva } = await import('../../motor/tmd/map/comandos.ts')
  const r = comandosDaIaAtiva(repoDir)
  expect(r.comandos.map(c => c.comando).sort()).toEqual(['/planeja', '/revisa'])
})

test('ollama nao contribui comandos — sem fonte confiavel no disco', async () => {
  process.env.HICODE_IMPLEMENT_PROVIDER = 'ollama'
  const { comandosDaIaAtiva } = await import('../../motor/tmd/map/comandos.ts')
  expect(comandosDaIaAtiva(repoDir).comandos).toEqual([])
})

test('sem nenhum diretorio no disco, devolve lista vazia sem quebrar', async () => {
  process.env.HICODE_IMPLEMENT_PROVIDER = 'claude'
  const { comandosDaIaAtiva } = await import('../../motor/tmd/map/comandos.ts')
  expect(comandosDaIaAtiva(join(repoDir, 'nao-existe')).comandos).toEqual([])
})

test('cache por tempo: nao le o disco de novo a cada chamada', async () => {
  process.env.HICODE_IMPLEMENT_PROVIDER = 'claude'
  comando(join(home, '.claude', 'commands'), 'foo', 'primeiro')
  const { comandosDaIaAtiva } = await import('../../motor/tmd/map/comandos.ts')
  const primeira = comandosDaIaAtiva(repoDir)
  expect(primeira.comandos.map(c => c.comando)).toEqual(['/foo'])
  comando(join(home, '.claude', 'commands'), 'novo', 'chegou depois')
  const segunda = comandosDaIaAtiva(repoDir)
  expect(segunda.comandos.map(c => c.comando)).toEqual(['/foo'])
})

test('SEGURANCA: description de repo clonado com escape ANSI nao vaza para o terminal', async () => {
  comando(join(repoDir, '.claude', 'commands'), 'malicioso', '\x1b[2J\x1b[31mpwned\x1b[0m normal')
  process.env.HICODE_IMPLEMENT_PROVIDER = 'claude'
  const { comandosDaIaAtiva } = await import('../../motor/tmd/map/comandos.ts')
  const r = comandosDaIaAtiva(repoDir)
  const c = r.comandos.find(c => c.comando === '/malicioso')
  expect(c?.descricao).not.toContain('\x1b')
  expect(c?.descricao).toBe('pwned normal')
})

test('SEGURANCA: nome de arquivo com escape ANSI nao vaza no proprio comando', async () => {
  mkdirSync(join(repoDir, '.claude', 'commands'), { recursive: true })
  writeFileSync(join(repoDir, '.claude', 'commands', 'x\x1b[31m.md'), '---\ndescription: "x"\n---\ncorpo\n')
  process.env.HICODE_IMPLEMENT_PROVIDER = 'claude'
  const { comandosDaIaAtiva } = await import('../../motor/tmd/map/comandos.ts')
  const r = comandosDaIaAtiva(repoDir)
  expect(r.comandos.some(c => c.comando.includes('\x1b'))).toBe(false)
})

test('cada ia tem uma cor de marca distinta', async () => {
  const { corDaIa } = await import('../../motor/tmd/map/comandos.ts')
  const nomes = ['claude', 'codex', 'kimi', 'ollama'] as const
  const cores = new Set(nomes.map(n => JSON.stringify(corDaIa(n))))
  expect(cores.size).toBe(4)
})
