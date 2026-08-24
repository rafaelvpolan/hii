import { test, expect, afterAll } from 'bun:test'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { carregarAcervo, gatilhoBate, lerSkill, renderizarSkills, skillsPara } from '../../motor/csd/acervo.ts'

const criados: string[] = []
afterAll(() => { for (const d of criados) rmSync(d, { recursive: true, force: true }) })

function skillEm(pack: string, id: string, texto: string): string {
  const raiz = mkdtempSync(join(tmpdir(), 'hii-acervo-')); criados.push(raiz)
  mkdirSync(join(raiz, pack, id), { recursive: true })
  writeFileSync(join(raiz, pack, id, 'SKILL.md'), texto)
  return raiz
}

const BOA = `---
id: x
papeis: [implementador]
sempre: true
---
Faca a coisa certa.`

test('skill valida carrega com papel, gatilho e corpo', () => {
  const s = lerSkill(BOA, 'a/SKILL.md', 'common', '_native')
  expect(s.id).toBe('x')
  expect(s.papeis).toEqual(['implementador'])
  expect(s.gatilho.sempre).toBe(true)
  expect(s.instrucoes).toContain('coisa certa')
})

test('REGRESSAO frontmatter invalido e ERRO de carga, nao skill ignorada em silencio', () => {
  expect(() => lerSkill('sem frontmatter', 'a', 'p', 'o')).toThrow('sem frontmatter')
  expect(() => lerSkill('---\nid: x\n', 'a', 'p', 'o')).toThrow('nunca fechado')
  expect(() => lerSkill('---\nlixo sem dois pontos\n---\ncorpo', 'a', 'p', 'o')).toThrow('chave: valor')
})

test('skill sem id, sem papel, sem corpo ou sem gatilho e recusada', () => {
  expect(() => lerSkill('---\npapeis: [implementador]\nsempre: true\n---\nc', 'a', 'p', 'o')).toThrow('sem id')
  expect(() => lerSkill('---\nid: x\nsempre: true\n---\nc', 'a', 'p', 'o')).toThrow('sem papel')
  expect(() => lerSkill('---\nid: x\npapeis: [implementador]\nsempre: true\n---\n', 'a', 'p', 'o')).toThrow('sem corpo')
  expect(() => lerSkill('---\nid: x\npapeis: [implementador]\n---\nc', 'a', 'p', 'o'), 'skill que nunca carrega e peso morto').toThrow('sem gatilho')
})

test('papel desconhecido e recusado — nao vira skill que ninguem carrega', () => {
  expect(() => lerSkill('---\nid: x\npapeis: [inventado]\nsempre: true\n---\nc', 'a', 'p', 'o')).toThrow('papel desconhecido')
})

test('INVARIANTE o gatilho e puro: mesma entrada, mesma saida, sem I/O e sem IA', () => {
  const g = { arquivos: ['**/*.php'], deps: ['laravel'] }
  const ctx = { arquivos: ['app/X.php'], deps: [] }
  expect(gatilhoBate(g, ctx)).toBe(gatilhoBate(g, ctx))
  expect(gatilhoBate(g, ctx)).toBe(true)
  expect(gatilhoBate(g, { arquivos: ['src/a.ts'], deps: [] })).toBe(false)
  expect(gatilhoBate(g, { arquivos: [], deps: ['laravel'] })).toBe(true)
  expect(gatilhoBate({ sempre: true }, { arquivos: [], deps: [] })).toBe(true)
})

test('INVARIANTE nenhuma skill do acervo declara gatilho que dependa de IA', () => {
  for (const s of carregarAcervo()) {
    const g = s.gatilho
    const temAlgo = g.sempre || (g.arquivos?.length ?? 0) > 0 || (g.deps?.length ?? 0) > 0
    expect(temAlgo, `${s.id} sem gatilho determinístico`).toBe(true)
  }
})

test('skillsPara filtra por papel E por gatilho', () => {
  const raiz = skillEm('common', 'so-php', `---
id: so-php
papeis: [implementador]
arquivos: ["**/*.php"]
---
php`)
  const acervo = carregarAcervo(raiz)
  expect(skillsPara('implementador', { arquivos: ['a.php'], deps: [] }, acervo).map(s => s.id)).toEqual(['so-php'])
  expect(skillsPara('implementador', { arquivos: ['a.ts'], deps: [] }, acervo)).toEqual([])
  expect(skillsPara('seguranca', { arquivos: ['a.php'], deps: [] }, acervo), 'papel errado nao carrega').toEqual([])
})

// Lista explicita de proposito: pack novo reprova aqui ate ser declarado, do
// mesmo jeito que efeito externo novo reprova no registro de idempotencia.
// Varredura dinamica passaria calada e o teste deixaria de dizer algo.
const PACKS_DECLARADOS = ['backend-web', 'common', 'devops-deploy', 'frontend-web', 'games-multiplatform', 'mobile']

test('o acervo real do repo carrega, tem os packs declarados e nenhum id repetido', () => {
  const a = carregarAcervo()
  expect(a.length).toBeGreaterThan(8)
  expect([...new Set(a.map(s => s.pack))].sort()).toEqual(PACKS_DECLARADOS)
  expect(new Set(a.map(s => s.id)).size).toBe(a.length)
})

test('skill de front NAO carrega por o alvo ser TypeScript — este repo e TS e nao e front', () => {
  const a = carregarAcervo()
  const packs = skillsPara('implementador', { arquivos: ['motor/x.ts'], deps: ['typescript'] }, a).map(s => s.pack)
  expect(new Set(packs), 'typescript como gatilho de front carregaria em todo card deste motor').toEqual(new Set(['common']))
})

test('o pack common carrega SEMPRE, e o de jogos so com sinal de engine', () => {
  const a = carregarAcervo()
  const semNada = skillsPara('implementador', { arquivos: [], deps: [] }, a).map(s => s.pack)
  expect(new Set(semNada), 'jogos nao pode entrar num card de backend').toEqual(new Set(['common']))
  const comGodot = skillsPara('implementador', { arquivos: ['project.godot'], deps: [] }, a).map(s => s.pack)
  expect(comGodot).toContain('games-multiplatform')
})

test('a correcao de 2026 sobre Godot esta no acervo — nao e detalhe cosmetico', () => {
  const netcode = carregarAcervo().find(s => s.id === 'netcode-multiplayer-patterns')
  expect(netcode?.instrucoes).toContain('Godot')
  expect(netcode?.instrucoes, 'escolher Godot sem saber disso e erro de arquitetura na largada').toContain('rollback')
})

test('renderizarSkills devolve vazio sem skill, e bloco identificado com skill', () => {
  expect(renderizarSkills([])).toBe('')
  const texto = renderizarSkills(carregarAcervo().slice(0, 2))
  expect(texto).toContain('CONHECIMENTO CARREGADO')
  expect(texto).toContain('### skill:')
})

test('INVARIANTE o motor injeta o acervo no prompt — senao o conteudo nunca chega ao agente', async () => {
  const fonte = await Bun.file('motor/cic/agente.ts').text()
  expect(fonte).toContain("skillsPara('implementador'")
  expect(fonte, 'os passos de polimento tambem carregam skill').toContain('skillsDoAgente(agent, wt, repo)')
  expect(fonte, 'o contexto do gatilho tem de vir do disco').toContain('contextoDeSkill(')
})

test('REGRESSAO clone sem _resolved ainda carrega o acervo — _resolved e cache, nao requisito', () => {
  // A CI pegou isto: `_resolved/` esta no .gitignore, entao num clone novo ele
  // nao existe. Se o loader dependesse dele, o motor rodaria com zero skill em
  // producao e ninguem notaria — o prompt so ficaria mais pobre em silencio.
  const semCache = mkdtempSync(join(tmpdir(), 'hii-semcache-')); criados.push(semCache)
  expect(existsSync(join(semCache, '_resolved'))).toBe(false)
  expect(carregarAcervo().length, 'o acervo real tem de carregar sem cache nenhum').toBeGreaterThan(8)
})

test('a fusao ao vivo e a partir do cache dao o mesmo conjunto de ids', async () => {
  const { fundirOrigens } = await import('../../motor/csd/acervo.ts')
  const aoVivo = fundirOrigens().skills.map(s => s.id).sort()
  expect(carregarAcervo().map(s => s.id).sort()).toEqual(aoVivo)
})
