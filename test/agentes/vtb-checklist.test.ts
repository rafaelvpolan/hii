import { test, expect } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { checklistParaStack, lerChecklist, renderizarChecklist, stacksComChecklist } from '../../motor/agentes/vtb/checklist.ts'

test('o repo tem checklist para as stacks que ele de fato atende', () => {
  expect(stacksComChecklist()).toEqual(['laravel', 'typescript'])
})

test('todo item tem id e texto de checagem — item sem id nao da para citar numa reprovacao', () => {
  for (const stack of stacksComChecklist()) {
    const c = lerChecklist(stack)
    expect(c?.itens.length, `${stack} sem item`).toBeGreaterThan(3)
    for (const i of c?.itens ?? []) {
      expect(i.id).not.toBe('')
      expect(i.checa.length).toBeGreaterThan(20)
    }
    expect(new Set(c?.itens.map(i => i.id)).size, `${stack} tem id repetido`).toBe(c?.itens.length ?? 0)
  }
})

test('a stack do contrato casa com o checklist, e sem match devolve null', () => {
  expect(checklistParaStack('Laravel 12 · PHP 8.4')?.stack).toBe('laravel')
  expect(checklistParaStack('TypeScript · Bun')?.stack).toBe('typescript')
  expect(checklistParaStack('Elixir · Phoenix'), 'sem match o baseline generico segue sozinho').toBeNull()
  expect(checklistParaStack('')).toBeNull()
})

test('o checklist de Laravel cobra o que mais quebra nesse stack', () => {
  const texto = renderizarChecklist(lerChecklist('laravel'))
  expect(texto).toContain('fillable')
  expect(texto).toContain('down()')
  expect(texto, 'cache com tag sem invalidacao no mesmo commit e o erro mais citado').toContain('invalidacao')
})

test('o de TypeScript cobra execFile e bind — os dois achados reais desta base', () => {
  const texto = renderizarChecklist(lerChecklist('typescript'))
  expect(texto).toContain('execFile')
  expect(texto).toContain('hostname')
})

test('renderizar sem checklist devolve vazio, nao cabecalho solto', () => {
  expect(renderizarChecklist(null)).toBe('')
})

// O teste que existia aqui era um grep no texto-fonte de agente.ts. Ele passou
// verde durante todo o tempo em que o checklist NAO chegava a agente nenhum: os
// tres chamadores de producao de runStep passavam 4 argumentos, `repo` era sempre
// '', stackOf('') devolvia a sentinela e checklistParaStack nunca casava.
// config/security-checklist/*.json era conteudo morto e o invariante nao viu.
//
// Os dois testes abaixo montam o prompt DE VERDADE, a partir de um alvo em disco
// com contrato real, e afirmam sobre o texto que o agente receberia.
function alvoComStack(stack: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'hicode-vtb-alvo-'))
  mkdirSync(join(dir, '.hii'), { recursive: true })
  writeFileSync(join(dir, '.hii', 'contract.json'), JSON.stringify({
    version: 1, generated: '', hash: '', shape: 'single', packageManager: 'npm',
    monorepo: false, main: '', packages: [], stack,
    commands: { build: '', test: '', lint: '', typecheck: '', dev: '' }, sources: [],
  }))
  return dir
}

test('COMPORTAMENTO o checklist da stack aparece no prompt do papel de seguranca', async () => {
  const { skillsDoAgente } = await import('../../motor/cic/agente.ts')
  const alvo = alvoComStack('TypeScript · Node 24 · npm')
  try {
    const texto = skillsDoAgente('escudo', alvo, alvo)
    expect(texto, 'o checklist versionado tem de alcancar o agente que faz seguranca').toContain('CHECKLIST DE SEGURANCA — typescript')
  } finally {
    rmSync(alvo, { recursive: true, force: true })
  }
})

test('COMPORTAMENTO papel que nao e seguranca nao recebe o checklist', async () => {
  const { skillsDoAgente } = await import('../../motor/cic/agente.ts')
  const alvo = alvoComStack('TypeScript · Node 24 · npm')
  try {
    expect(skillsDoAgente('pura', alvo, alvo)).not.toContain('CHECKLIST DE SEGURANCA')
  } finally {
    rmSync(alvo, { recursive: true, force: true })
  }
})

test('COMPORTAMENTO alvo sem contrato nao inventa checklist', async () => {
  const { skillsDoAgente } = await import('../../motor/cic/agente.ts')
  const vazio = mkdtempSync(join(tmpdir(), 'hicode-vtb-vazio-'))
  try {
    expect(skillsDoAgente('escudo', vazio, vazio)).not.toContain('CHECKLIST DE SEGURANCA')
  } finally {
    rmSync(vazio, { recursive: true, force: true })
  }
})
