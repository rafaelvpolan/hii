import { test, expect } from '../apoio/runner.ts'
import { lerAgente, agentesNexus, agentesNexusPor, agentesNexusJsonPor } from '../../motor/agentes/registro.ts'

const MD = `---
name: vitro
description: "agente de teste"
tools: Read, Write, Edit, Bash, Glob, Grep
model: sonnet
---

Prompt do agente.
`

test('lerAgente converte tools do frontmatter (string) em ARRAY na borda', () => {
  // O .md usa a lista em string (formato do Claude Code); o --agents do CLI
  // valida o JSON e exige array. A conversao mora no parser.
  const lido = lerAgente(MD)
  expect(lido?.nome).toBe('vitro')
  expect(lido?.agente.tools).toEqual(['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'])
  expect(lido?.agente.model).toBe('sonnet')
})

test('lerAgente sem tools deixa tools de fora (campo opcional)', () => {
  const lido = lerAgente(MD.replace('tools: Read, Write, Edit, Bash, Glob, Grep\n', ''))
  expect(lido?.agente.tools).toBeUndefined()
})

test('lerAgente tolera espacos e aspas na lista de tools', () => {
  const lido = lerAgente(MD.replace('tools: Read, Write, Edit, Bash, Glob, Grep', 'tools: "Read,Edit"'))
  expect(lido?.agente.tools).toEqual(['Read', 'Edit'])
})

test('REGRESSAO: o JSON do --agents leva tools como ARRAY para todo agente do disco — o CLI recusa string', () => {
  // Erro real no restart do motor: "vitro.tools: Invalid input: expected array,
  // received string". Se qualquer agente voltar a serializar tools como string,
  // o claude CLI rejeita o --agents inteiro e o card morre no arranque.
  const catalogo = agentesNexus()
  expect(Object.keys(catalogo).length).toBeGreaterThan(0)
  for (const [nome, agente] of Object.entries(catalogo)) {
    if (agente.tools !== undefined) expect(Array.isArray(agente.tools), `${nome}.tools serializado como ${typeof agente.tools}`).toBe(true)
  }
  const json = JSON.parse(agentesNexusJsonPor(['vitro'])) as Record<string, { tools?: unknown }>
  expect(Array.isArray(json['vitro']?.tools)).toBe(true)
})

test('ferramentas extra somam no array sem duplicar e sem virar string', () => {
  const vitro = agentesNexusPor(['vitro'], ['mcp__omc__lsp_goto_definition', 'Read'])['vitro']
  expect(Array.isArray(vitro?.tools)).toBe(true)
  expect(vitro?.tools).toContain('mcp__omc__lsp_goto_definition')
  expect(vitro?.tools).toContain('Read')
  expect(vitro?.tools?.filter(t => t === 'Read')).toHaveLength(1)
})
