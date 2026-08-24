import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handle, newSession, canonico } from '../../motor/mir/sessao.ts'
import { dispatch } from '../../motor/mir/despacho.ts'
import { dispatchIOFalso } from '../fixtures/dispatch-io-falso.ts'

// MIR — /ia, /model, /effort e /mode nao tinham teste nenhum, e a varredura de
// test/mir/mapa-de-comandos.test.ts encontrou os quatro. Sao exatamente os
// comandos que mudam QUAL modelo gasta o token do usuario: superficie sem
// cobertura no lugar mais caro de errar.

let dir = ''
let saida: string[] = []
const io = dispatchIOFalso({ log: (l: string) => { saida.push(l) } })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hicode-cmd-modelo-'))
  mkdirSync(join(dir, 'runs'), { recursive: true })
  process.env.HICODE_CARDS_DIR = dir
  process.env.HICODE_IA_FILE = join(dir, 'ia.json')
  saida = []
})

afterEach(() => {
  delete process.env.HICODE_CARDS_DIR
  delete process.env.HICODE_IA_FILE
})

const CASOS: ReadonlyArray<readonly [string, string, readonly string[]]> = [
  ['/ia', 'ia', ['/provedor']],
  ['/model', 'modelo', ['/modelo']],
  ['/effort', 'esforco', ['/esforco']],
  ['/mode', 'modo', ['/modo']],
]

test('cada comando de configuracao vira o efeito que lhe corresponde', () => {
  for (const [cmd, kind] of CASOS) {
    const r = handle(cmd, newSession())
    expect([cmd, r.effect.kind]).toEqual([cmd, kind])
  }
})

test('os apelidos produzem o MESMO efeito do nome principal', () => {
  for (const [cmd, kind, apelidos] of CASOS) {
    for (const a of apelidos) {
      expect([a, handle(a, newSession()).effect.kind]).toEqual([a, kind])
      expect([a, canonico(a)]).toEqual([a, cmd])
    }
  }
})

test('o argumento chega inteiro ao efeito — e o que escolhe modelo e esforco', () => {
  expect(handle('/model claude opus', newSession()).effect.text).toBe('claude opus')
  expect(handle('/effort implement alto', newSession()).effect.text).toBe('implement alto')
  expect(handle('/mode plan', newSession()).effect.text).toBe('plan')
  expect(handle('/ia verify codex', newSession()).effect.text).toBe('verify codex')
})

test('sem argumento o comando nao vira erro — ele mostra o estado atual', () => {
  for (const [cmd] of CASOS) {
    const r = handle(cmd, newSession())
    expect([cmd, r.effect.kind]).not.toEqual([cmd, 'error'])
    expect([cmd, r.effect.text ?? '']).toEqual([cmd, ''])
  }
})

test('nenhum dos quatro mexe no estado da sessao — sao configuracao, nao navegacao', () => {
  const base = { ...newSession('org/app'), seguindo: '042' }
  for (const [cmd] of CASOS) {
    expect([cmd, handle(cmd, base).state]).toEqual([cmd, base])
  }
})

test('/ia sem argumento explica o uso em vez de falhar calado', async () => {
  const r = handle('/ia', newSession())
  await dispatch(r.effect, r.state, io)
  expect(saida.length, '/ia sem argumento nao pode nao dizer nada').toBeGreaterThan(0)
  expect(saida.join('\n')).toContain('/ia')
})

// Este teste declarava o oposto do que o codigo fazia. `not.toContain('aplicado
// com sucesso')` era assercao sobre uma string que o repo NUNCA emite — passava
// verde enquanto `/ia provedor-que-nao-existe` era aceito e gravado como MODELO
// em todos os papeis. Agora afirma o comportamento: recusa nomeando o token.
test('/ia com provedor inexistente RECUSA, nomeia o token e diz o que aceita', async () => {
  const r = handle('/ia provedor-que-nao-existe', newSession())
  await dispatch(r.effect, r.state, io)
  const texto = saida.join('\n')
  expect(texto).toContain('provedor-que-nao-existe')
  expect(texto.toLowerCase()).toContain('nao entendi')
  expect(texto, 'a recusa tem de dizer o que ele podia ter digitado').toContain('/model')
})

test('/ia claude opus continua valendo — o token solto e modelo DEPOIS do provedor', async () => {
  const { interpretar } = await import('../../motor/mir/escolher-ia.ts')
  expect(interpretar(['claude', 'opus']).ajuste).toMatchObject({ provider: 'claude', model: 'opus' })
  expect(interpretar(['opus']).erro, 'sem provedor nomeado, token solto e recusado').toBeTruthy()
  expect(interpretar(['modelo=opus']).ajuste, 'a forma explicita continua aceita sem provedor').toMatchObject({ model: 'opus' })
})

test('/ia padrao limpa a escolha sem derrubar a sessao', async () => {
  const r = handle('/ia padrao', newSession('org/app'))
  const d = await dispatch(r.effect, r.state, io)
  expect(saida.length).toBeGreaterThan(0)
  expect(d.state.repo).toBe('org/app')
})

test('os quatro respondem em QUALQUER estado, sem lancar e sem virar desconhecido', async () => {
  const estados = [
    newSession(),
    { ...newSession(), pendingPlan: '12' },
    { ...newSession(), perguntando: '12' },
    { ...newSession(), aprovando: '12' },
    { ...newSession(), seguindo: '12' },
    { ...newSession(), tela: 'config' as const },
  ]
  for (const [cmd] of CASOS) {
    for (const estado of estados) {
      saida = []
      const r = handle(cmd, estado)
      expect([cmd, r.effect.kind]).not.toEqual([cmd, 'error'])
      await dispatch(r.effect, r.state, io)
      expect(saida.join(' '), `${cmd} virou desconhecido`).not.toContain('comando desconhecido')
    }
  }
})
