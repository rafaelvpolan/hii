import { test, expect, afterAll } from '../apoio/runner.ts'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hii-pastas-ia-'))
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const { initHicodeHome } = await import('../../motor/cordel/alicerce/home.ts')
const { projetarParaClaude } = await import('../../motor/cordel/alicerce/pastas-por-ia.ts')
const { agentesNexusPor } = await import('../../motor/agentes/registro.ts')

let n = 0
function projeto(): string {
  const dir = join(BASE, `p${n++}`)
  mkdirSync(dir, { recursive: true })
  initHicodeHome(dir)
  return dir
}

test('init cria memoria e uma pasta por IA, e o gitignore so ignora estado e contrato', () => {
  const p = projeto()
  for (const d of ['memory', 'ia/claude/agents', 'ia/claude/skills', 'ia/ollama/agents', 'ia/ollama/skills']) expect(existsSync(join(p, '.hii', d))).toBe(true)
  expect(readFileSync(join(p, '.hii', 'ia', 'claude', 'LEIA-ME.md'), 'utf8')).toContain('.claude/agents')
  expect(readFileSync(join(p, '.hii', '.gitignore'), 'utf8')).toBe('state/\ncontract.json\n')
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
