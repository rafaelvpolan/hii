import { test, expect, afterAll, afterEach } from '../apoio/runner.ts'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hii-pacote-'))
process.env.HII_CARDS_DIR = join(BASE, 'cards')
mkdirSync(process.env.HII_CARDS_DIR, { recursive: true })
mkdirSync(join(BASE, 'projeto', '.hii'), { recursive: true })
writeFileSync(join(BASE, 'projeto', '.hii', 'rules.md'), 'Use Vue 3 com Composition API.\n')
process.env.HII_REPOS_FILE = join(BASE, 'repos.json')
writeFileSync(process.env.HII_REPOS_FILE, JSON.stringify([{ name: 'org/site', path: join(BASE, 'projeto') }]))

const { createCard, readCard } = await import('../../motor/cordel/store.ts')
const { liberarPeloPacote, definirIaDoCard, iasDoCard } = await import('../../motor/niemeyer/lucio/aprovacao-do-pacote.ts')
const { montarPacote } = await import('../../motor/niemeyer/lucio/pacote-de-execucao.ts')
const { pendencia, responder } = await import('../../motor/mirante/responder.ts')

afterEach(() => { delete process.env.HII_PROMPT_PRIMEIRO })
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

function tarefa(titulo = 'trocar os icones do rodape'): string {
  return createCard({ title: titulo, status: 'EXECUTING', repo: 'org/site', motor_modo: 'passivo' }, `## Objetivo\n${titulo}\n`)
}

test('antes de qualquer IA, a tarefa para com o pacote para revisao', () => {
  const id = tarefa()
  expect(liberarPeloPacote(id)).toBe(false)
  const fm = readCard(id)?.fm
  expect(fm?.status).toBe('CLARIFY')
  expect(fm?.pacote_status).toBe('aguardando')
  const md = readFileSync(fm?.pacote_arquivo ?? '', 'utf8')
  expect(md).toContain('## Prompt do implementador')
  expect(md).toContain('trocar os icones do rodape')
  expect(md).toContain('Use Vue 3 com Composition API.')
  expect(md).toContain('## Gates do pipeline')
  expect(md).toContain('## IA por papel')
})

test('a pergunta do pacote aparece no canal de perguntas', () => {
  const id = tarefa()
  liberarPeloPacote(id)
  const p = pendencia(id)
  expect(p?.origem).toBe('pacote')
  expect(p?.atual.options).toEqual(['Aprovar e executar', 'Cancelar a tarefa'])
  expect(p?.atual.q).toContain('IA que implementa')
})

test('aprovar libera a execucao, e o mesmo pacote nao pergunta de novo', () => {
  const id = tarefa()
  liberarPeloPacote(id)
  const r = responder(id, '1')
  expect(r.retomou).toBe(true)
  const fm = readCard(id)?.fm
  expect(fm?.status).toBe('EXECUTING')
  expect(fm?.pacote_aprovado_hash).toBe(fm?.pacote_hash)
  expect(liberarPeloPacote(id)).toBe(true)
})

test('texto livre ajusta o pedido e gera pacote novo antes de executar', () => {
  const id = tarefa()
  liberarPeloPacote(id)
  const hashAntes = readCard(id)?.fm.pacote_hash
  responder(id, 'use icones de linha, nao preenchidos')
  expect(readCard(id)?.fm.status).toBe('EXECUTING')
  expect(liberarPeloPacote(id)).toBe(false)
  const fm = readCard(id)?.fm
  expect(fm?.pacote_hash).not.toBe(hashAntes)
  expect(readFileSync(fm?.pacote_arquivo ?? '', 'utf8')).toContain('use icones de linha, nao preenchidos')
})

test('cancelar para a tarefa como parada humana', () => {
  const id = tarefa()
  liberarPeloPacote(id)
  responder(id, '2')
  const fm = readCard(id)?.fm
  expect(fm?.status).toBe('HALTED')
  expect(fm?.halt_class).toBe('humano')
})

test('HII_PROMPT_PRIMEIRO=off mantem o despacho direto', () => {
  process.env.HII_PROMPT_PRIMEIRO = 'off'
  const id = tarefa()
  expect(liberarPeloPacote(id)).toBe(true)
  expect(readCard(id)?.fm.status).toBe('EXECUTING')
})

test('a IA escolhida para o card aparece no pacote e nao exige nova aprovacao', () => {
  const id = tarefa()
  liberarPeloPacote(id)
  const hash = readCard(id)?.fm.pacote_hash
  expect(definirIaDoCard(id, { papel: 'implement', provedor: 'codex', modelo: 'modelo-x' }).ok).toBe(true)
  const fm = readCard(id)?.fm
  expect(fm?.provider_override_implement).toBe('codex')
  expect(fm?.pacote_hash).toBe(hash)
  expect(fm?.pacote_resumo).toContain('codex (modelo-x)')
  expect(iasDoCard(fm ?? {}).find(i => i.papel === 'implement')?.provedor).toBe('codex')
  const pacote = montarPacote(readCard(id)!)
  expect(pacote.ias.find(i => i.papel === 'implement')?.provedor).toBe('codex')
})

test('IA desconhecida ou papel invalido sao recusados', () => {
  const id = tarefa()
  expect(definirIaDoCard(id, { papel: 'implement', provedor: 'ia-que-nao-existe' }).ok).toBe(false)
  expect(definirIaDoCard(id, { papel: 'faxina', provedor: 'codex' }).ok).toBe(false)
  expect(existsSync(join(BASE, 'cards', 'pacotes', `${id}.md`))).toBe(false)
})
