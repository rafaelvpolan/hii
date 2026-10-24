import { test, expect, beforeEach, afterEach } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ComandoDaIa } from '../../motor/tomada/mapa/comandos.ts'

// Os comandos do /hii global (hii, hii-plan, hii-refinar, hii-review, hii-review-pr)
// moram na pasta versionada do Claude do motor (ia/claude/comandos) e entram no
// catalogo como recursos do orquestrador. O canal diz por onde cada um chega: a
// escrita pela instrucao da tarefa, a leitura pela conversa.

let home = ''
let repoDir = ''
const antigo: Record<string, string | undefined> = {}

function guardar(chave: string, valor: string | undefined): void {
  if (!(chave in antigo)) antigo[chave] = process.env[chave]
  if (valor === undefined) delete process.env[chave]
  else process.env[chave] = valor
}

function comando(dir: string, nome: string, frontMatter: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${nome}.md`), `---\n${frontMatter}\n---\ncorpo pessoal de ${nome}\n`)
}

// O canal e campo novo de ComandoDaIa; lido por um registro intermediario para o
// teste nao depender de como a interface o declara.
function canalDe(c: ComandoDaIa | undefined): string | undefined {
  if (!c) return undefined
  const campos: Record<string, string | undefined> = { ...c }
  return campos.canal
}

function corpoDoArquivo(caminho: string): string {
  const texto = readFileSync(caminho, 'utf8').replace(/\r/g, '')
  const m = texto.match(/^---\n([\s\S]*?)\n---/)
  return (m ? texto.slice((m.index ?? 0) + m[0].length) : texto).trim()
}

const DA_PASTA = ['/hii', '/hii-plan', '/hii-refinar', '/hii-review', '/hii-review-pr']
const DE_LEITURA = ['/hii-plan', '/hii-review', '/hii-review-pr']
const DE_ESCRITA = ['/hii', '/hii-refinar']

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'hii-pasta-cmd-home-'))
  repoDir = mkdtempSync(join(tmpdir(), 'hii-pasta-cmd-repo-'))
  guardar('HOME', home)
  guardar('CODEX_HOME', join(home, '.codex'))
  guardar('HII_CLAUDE_HOME_DIR', join(home, '.claude'))
  guardar('HII_KIMI_HOME_DIR', join(home, '.kimi-code'))
  guardar('HII_IA_FILE', join(home, 'sem-preferencias.json'))
  guardar('HII_IMPLEMENT_PROVIDER', 'claude')
})

afterEach(() => {
  for (const [chave, valor] of Object.entries(antigo)) {
    if (valor === undefined) delete process.env[chave]
    else process.env[chave] = valor
    delete antigo[chave]
  }
  rmSync(home, { recursive: true, force: true })
  rmSync(repoDir, { recursive: true, force: true })
})

test('claude-pasta-comandos: com implement=claude o catalogo traz os 5 comandos da pasta como orquestrador, com descricao e instrucoes', async () => {
  const { comandosDaIaAtiva } = await import('../../motor/tomada/mapa/comandos.ts')
  const r = comandosDaIaAtiva(repoDir)
  expect(r.provedor).toBe('claude')
  for (const nome of DA_PASTA) {
    const c = r.comandos.find(x => x.comando === nome)
    expect(c, nome).toBeDefined()
    expect(c?.origem, nome).toBe('orquestrador')
    expect((c?.descricao ?? '').trim().length, nome).toBeGreaterThan(0)
    expect((c?.instrucoes ?? '').trim().length, nome).toBeGreaterThan(0)
  }
})

test('claude-pasta-comandos: canal leitura em hii-plan, hii-review e hii-review-pr; escrita em hii e hii-refinar', async () => {
  const { comandosDaIaAtiva } = await import('../../motor/tomada/mapa/comandos.ts')
  const comandos = comandosDaIaAtiva(repoDir).comandos
  for (const nome of DE_LEITURA) expect(canalDe(comandos.find(c => c.comando === nome)), nome).toBe('leitura')
  for (const nome of DE_ESCRITA) expect(canalDe(comandos.find(c => c.comando === nome)), nome).toBe('escrita')
})

test('claude-pasta-comandos: as instrucoes do catalogo sao o corpo do arquivo da pasta (ia/claude/comandos)', async () => {
  const { PASTA_DO_CLAUDE } = await import('../../motor/tomada/harness/pasta-do-claude.ts')
  const { comandosDaIaAtiva } = await import('../../motor/tomada/mapa/comandos.ts')
  expect(PASTA_DO_CLAUDE).toBe(join(import.meta.dirname, '..', '..', 'ia', 'claude'))
  const comandos = comandosDaIaAtiva(repoDir).comandos
  for (const nome of DA_PASTA) {
    const corpo = corpoDoArquivo(join(PASTA_DO_CLAUDE, 'comandos', `${nome.slice(1)}.md`))
    expect(corpo.length, nome).toBeGreaterThan(0)
    expect(comandos.find(c => c.comando === nome)?.instrucoes, nome).toBe(corpo)
  }
})

test('claude-pasta-comandos: comando pessoal ~/.claude/commands/hii-review.md com outra descricao nao substitui o da pasta', async () => {
  comando(join(home, '.claude', 'commands'), 'hii-review', 'description: "revisao pessoal que nao deve vencer"')
  const { comandosDaIaAtiva } = await import('../../motor/tomada/mapa/comandos.ts')
  const achados = comandosDaIaAtiva(repoDir).comandos.filter(c => c.comando === '/hii-review')
  expect(achados).toHaveLength(1)
  const c = achados[0]
  expect(c?.origem).toBe('orquestrador')
  expect(c?.descricao).not.toBe('revisao pessoal que nao deve vencer')
  expect(c?.instrucoes ?? '').not.toContain('corpo pessoal de hii-review')
  expect(canalDe(c)).toBe('leitura')
})

test('claude-pasta-comandos: canal so vale nos arquivos da pasta — repositorio alheio nao desvia o despacho', async () => {
  comando(join(repoDir, '.claude', 'commands'), 'hii-review', 'description: "do repo"\ncanal: escrita')
  comando(join(repoDir, '.claude', 'commands'), 'alheio', 'description: "comando do repo"\ncanal: leitura')
  const { comandosDaIaAtiva } = await import('../../motor/tomada/mapa/comandos.ts')
  const comandos = comandosDaIaAtiva(repoDir).comandos
  expect(canalDe(comandos.find(c => c.comando === '/hii-review'))).toBe('leitura')
  expect(comandos.find(c => c.comando === '/hii-review')?.descricao).not.toBe('do repo')
  const alheio = comandos.find(c => c.comando === '/alheio')
  expect(alheio?.origem).toBe('ia')
  expect(canalDe(alheio)).toBeUndefined()
})

test('claude-pasta-comandos: codex/kimi nao veem — com HII_IMPLEMENT_PROVIDER=codex e =kimi nenhum comando da pasta aparece', async () => {
  const { comandosDaIaAtiva } = await import('../../motor/tomada/mapa/comandos.ts')
  for (const provedor of ['codex', 'kimi']) {
    process.env.HII_IMPLEMENT_PROVIDER = provedor
    const r = comandosDaIaAtiva(repoDir)
    expect(r.provedor, provedor).toBe(provedor)
    const nomes = r.comandos.map(c => c.comando)
    for (const nome of DA_PASTA) expect(nomes, `${provedor} ${nome}`).not.toContain(nome)
  }
  // troca de IA via /ia: a chave do memo inclui o provedor, efeito imediato
  process.env.HII_IMPLEMENT_PROVIDER = 'claude'
  expect(comandosDaIaAtiva(repoDir).comandos.map(c => c.comando)).toContain('/hii-review')
})

test('claude-pasta-comandos: instrucoesDosComandos("/hii-refinar organizar") injeta o corpo do comando da pasta', async () => {
  const { PASTA_DO_CLAUDE } = await import('../../motor/tomada/harness/pasta-do-claude.ts')
  const { instrucoesDosComandos } = await import('../../motor/tomada/mapa/comandos.ts')
  const texto = instrucoesDosComandos('/hii-refinar organizar', repoDir)
  expect(texto).toContain(corpoDoArquivo(join(PASTA_DO_CLAUDE, 'comandos', 'hii-refinar.md')))
  expect(texto).toContain('/hii-refinar')
})

test('claude-pasta-comandos: comando de leitura nunca vai ao prompt de escrita — instrucoesDosComandos("/hii-review x") e vazio', async () => {
  const { instrucoesDosComandos } = await import('../../motor/tomada/mapa/comandos.ts')
  expect(instrucoesDosComandos('/hii-review x', repoDir)).toBe('')
  expect(instrucoesDosComandos('/hii-plan desenhar o modulo', repoDir)).toBe('')
  expect(instrucoesDosComandos('/hii-review-pr 7', repoDir)).toBe('')
  // nem dentro de um caminho no meio do texto
  expect(instrucoesDosComandos('ajuste docs/hii-review/x.md', repoDir)).toBe('')
  // e a mistura so leva o de escrita
  const misto = instrucoesDosComandos('/hii-refinar organizar e depois /hii-review', repoDir)
  expect(misto).toContain('/hii-refinar')
  expect(misto).not.toContain('### /hii-review ')
})

test('claude-pasta-comandos: o texto injetado de cada comando da pasta nao contem motor.mjs nem .claude/skills/hii', async () => {
  const { PASTA_DO_CLAUDE } = await import('../../motor/tomada/harness/pasta-do-claude.ts')
  const { comandosDaIaAtiva, instrucoesDosComandos } = await import('../../motor/tomada/mapa/comandos.ts')
  const comandos = comandosDaIaAtiva(repoDir).comandos
  for (const nome of DA_PASTA) {
    const injetado = comandos.find(c => c.comando === nome)?.instrucoes ?? ''
    const doDisco = readFileSync(join(PASTA_DO_CLAUDE, 'comandos', `${nome.slice(1)}.md`), 'utf8')
    for (const texto of [injetado, doDisco]) {
      expect(texto, nome).not.toContain('motor.mjs')
      expect(texto, nome).not.toContain('.claude/skills/hii')
    }
  }
  for (const nome of DE_ESCRITA) {
    const prompt = instrucoesDosComandos(`${nome} fazer algo`, repoDir)
    expect(prompt, nome).not.toContain('motor.mjs')
    expect(prompt, nome).not.toContain('.claude/skills/hii')
  }
})

test('claude-pasta-comandos: comandosDeLeituraDaPasta nao depende do implement e so traz os de canal leitura', async () => {
  const { comandosDeLeituraDaPasta } = await import('../../motor/tomada/mapa/comandos.ts')
  for (const provedor of ['claude', 'codex', 'kimi', 'ollama']) {
    process.env.HII_IMPLEMENT_PROVIDER = provedor
    const lidos = comandosDeLeituraDaPasta()
    expect(lidos.map(c => c.comando).sort(), provedor).toEqual([...DE_LEITURA].sort())
    for (const c of lidos) {
      expect(c.origem, `${provedor} ${c.comando}`).toBe('orquestrador')
      expect(canalDe(c), `${provedor} ${c.comando}`).toBe('leitura')
      expect((c.instrucoes ?? '').trim().length, `${provedor} ${c.comando}`).toBeGreaterThan(0)
    }
  }
})
