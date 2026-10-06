import { test, expect, afterAll } from '../apoio/runner.ts'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hii-pastas-ia-'))
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const { initHicodeHome } = await import('../../motor/cordel/alicerce/home.ts')
const { projetarParaClaude, projetarParaCodex } = await import('../../motor/cordel/alicerce/pastas-por-ia.ts')
const { agentesNexusPor } = await import('../../motor/agentes/registro.ts')

let n = 0
function projeto(): string {
  const dir = join(BASE, `p${n++}`)
  mkdirSync(dir, { recursive: true })
  initHicodeHome(dir)
  return dir
}

test('init cria memoria e uma pasta por IA, e o gitignore preserva memoria e ignora execucoes transitorias', () => {
  const p = projeto()
  for (const d of ['memory', 'ia/claude/agents', 'ia/claude/skills', 'ia/ollama/agents', 'ia/ollama/skills']) expect(existsSync(join(p, '.hii', d))).toBe(true)
  expect(readFileSync(join(p, '.hii', 'ia', 'claude', 'LEIA-ME.md'), 'utf8')).toContain('.claude/agents')
  expect(readFileSync(join(p, '.hii', '.gitignore'), 'utf8')).toBe('state/\ncontract.json\nia/*/executions/\n')
  expect(readFileSync(join(p, '.hii', 'rules.md'), 'utf8')).not.toContain('ADITIVAS ao CLAUDE.md')
})

test('projetar para o claude grava o bloco gerenciado, preserva texto humano e e idempotente', () => {
  const p = projeto()
  writeFileSync(join(p, '.hii', 'rules.md'), 'Use Vue 3.\n')
  writeFileSync(join(p, 'CLAUDE.md'), '# Notas do time\nnao apagar\n')
  projetarParaClaude(p)
  const primeiro = readFileSync(join(p, 'CLAUDE.md'), 'utf8')
  expect(primeiro).toContain('nao apagar')
  expect(primeiro).toContain('Use Vue 3.')
  writeFileSync(join(p, '.hii', 'rules.md'), 'Use Vue 3 com Composition API.\n')
  projetarParaClaude(p)
  const segundo = readFileSync(join(p, 'CLAUDE.md'), 'utf8')
  expect(segundo).toContain('Use Vue 3 com Composition API.')
  expect(segundo.split('hii:inicio').length).toBe(2)
  expect(projetarParaClaude(p).escritos).toEqual([])
})

test('papeis e skills do claude vao para o padrao nativo sem sobrescrever arquivo humano', () => {
  const p = projeto()
  writeFileSync(join(p, '.hii', 'ia', 'claude', 'agents', 'designer.md'), '---\nname: designer\ndescription: cuida do visual\n---\nprompt\n')
  mkdirSync(join(p, '.hii', 'ia', 'claude', 'skills', 'icones'), { recursive: true })
  writeFileSync(join(p, '.hii', 'ia', 'claude', 'skills', 'icones', 'SKILL.md'), 'skill de icones\n')
  mkdirSync(join(p, '.claude', 'agents'), { recursive: true })
  writeFileSync(join(p, '.claude', 'agents', 'designer.md'), 'versao humana\n')
  const r = projetarParaClaude(p)
  expect(readFileSync(join(p, '.claude', 'agents', 'designer.md'), 'utf8')).toBe('versao humana\n')
  expect(r.preservados).toContain(join(p, '.claude', 'agents', 'designer.md'))
  expect(readFileSync(join(p, '.claude', 'skills', 'icones', 'SKILL.md'), 'utf8')).toBe('skill de icones\n')
  expect(existsSync(join(p, '.claude', 'agents', 'LEIA-ME.md'))).toBe(false)
})

test('papel na pasta da IA do projeto vence o catalogo do motor para aquela IA', () => {
  const p = projeto()
  writeFileSync(join(p, '.hii', 'ia', 'ollama', 'agents', 'limpio.md'), '---\nname: limpio\ndescription: versao do projeto para o ollama\n---\nprompt local\n')
  const doProjeto = agentesNexusPor(['limpio'], [], { alvo: p, provedor: 'ollama' })
  expect(doProjeto.limpio?.description).toBe('versao do projeto para o ollama')
  const outraIa = agentesNexusPor(['limpio'], [], { alvo: p, provedor: 'claude' })
  expect(outraIa.limpio?.description ?? '').not.toBe('versao do projeto para o ollama')
})

test('Codex recebe regras e skills nativas sem apagar instrucoes do time', () => {
  const p = projeto()
  writeFileSync(join(p, 'AGENTS.md'), '# Convencoes humanas\n')
  const origem = join(p, '.hii', 'ia', 'codex', 'skills', 'testar')
  mkdirSync(origem, { recursive: true })
  writeFileSync(join(origem, 'SKILL.md'), '---\nname: testar\ndescription: testar fluxo\n---\nUse fixtures.')
  projetarParaCodex(p)
  expect(readFileSync(join(p, 'AGENTS.md'), 'utf8')).toContain('Convencoes humanas')
  expect(readFileSync(join(p, '.agents', 'skills', 'testar', 'SKILL.md'), 'utf8')).toContain('Use fixtures.')
  expect(projetarParaCodex(p).escritos).toEqual([])
  expect(existsSync(join(p, '.hii', 'ia', 'codex', 'executions'))).toBe(true)
})
test('projecao nao segue links da fonte para fora do projeto', () => {
  const p = projeto()
  const fora = join(BASE, 'segredo.md')
  writeFileSync(fora, 'nao copiar')
  symlinkSync(fora, join(p, '.hii', 'ia', 'codex', 'skills', 'link.md'))
  projetarParaCodex(p)
  expect(existsSync(join(p, '.agents', 'skills', 'link.md'))).toBe(false)
})

test('projecao atualiza apenas skills anteriormente gerenciadas e preserva edicao humana', () => {
  const p = projeto()
  const fonte = join(p, '.hii', 'ia', 'codex', 'skills', 'revisar')
  mkdirSync(fonte, { recursive: true })
  const origem = join(fonte, 'SKILL.md')
  const destino = join(p, '.agents', 'skills', 'revisar', 'SKILL.md')
  writeFileSync(origem, 'versao 1')
  projetarParaCodex(p)
  writeFileSync(origem, 'versao 2')
  expect(projetarParaCodex(p).escritos).toContain(destino)
  expect(readFileSync(destino, 'utf8')).toBe('versao 2')
  writeFileSync(destino, 'ajuste humano')
  writeFileSync(origem, 'versao 3')
  expect(projetarParaCodex(p).preservados).toContain(destino)
  expect(readFileSync(destino, 'utf8')).toBe('ajuste humano')
})
test('projecao nao escreve atraves de diretorio simbolico de destino', () => {
  const p = projeto()
  const fonte = join(p, '.hii', 'ia', 'codex', 'skills', 'segura')
  mkdirSync(fonte, { recursive: true })
  writeFileSync(join(fonte, 'SKILL.md'), 'conteudo')
  const fora = join(BASE, 'destino-externo')
  mkdirSync(fora)
  symlinkSync(fora, join(p, '.agents'))
  const r = projetarParaCodex(p)
  expect(r.preservados).toContain(join(p, '.agents', 'skills', 'segura', 'SKILL.md'))
  expect(existsSync(join(fora, 'skills'))).toBe(false)
})

test('link quebrado em AGENTS.md nao cria arquivo fora do projeto', () => {
  const p = projeto()
  const fora = join(BASE, 'nao-criar.md')
  symlinkSync(fora, join(p, 'AGENTS.md'))
  expect(() => projetarParaCodex(p)).toThrow()
  expect(existsSync(fora)).toBe(false)
})

test('init em projeto antigo acrescenta ao .gitignore so as regras que faltam', () => {
  const p = projeto()
  const ignore = join(p, '.hii', '.gitignore')
  writeFileSync(ignore, 'state/\ncontract.json\nsegredo-local/\n')
  initHicodeHome(p)
  expect(readFileSync(ignore, 'utf8')).toBe('state/\ncontract.json\nsegredo-local/\nia/*/executions/\n')
  initHicodeHome(p)
  expect(readFileSync(ignore, 'utf8')).toBe('state/\ncontract.json\nsegredo-local/\nia/*/executions/\n')
})
