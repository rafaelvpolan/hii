import { test, expect } from '../apoio/runner.ts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { handle, newSession, COMMANDS, ALIASES, canonico } from '../../motor/mirante/sessao.ts'
import type { EffectKind } from '../../motor/mirante/sessao.ts'

const raiz = join(import.meta.dirname, '..', '..')
const fonteDispatch = readFileSync(join(raiz, 'motor/mirante/despacho.ts'), 'utf8')
const fonteSession = readFileSync(join(raiz, 'motor/mirante/sessao.ts'), 'utf8')

function casesDoSwitch(fonte: string): string[] {
  return [...fonte.matchAll(/^ {4}case '([^']+)':/gm)].map(m => m[1] ?? '')
}

test('nenhum case duplicado no dispatch — o segundo seria codigo morto', () => {
  const cases = casesDoSwitch(fonteDispatch)
  const vistos = new Set<string>()
  const duplicados = cases.filter(c => (vistos.has(c) ? true : (vistos.add(c), false)))
  expect(duplicados).toEqual([])
})

test('nenhum EffectKind repetido na uniao — TypeScript deduplica em silencio', () => {
  const bloco = fonteSession.match(/export type EffectKind =([\s\S]*?)\n\n/)?.[1] ?? ''
  const nomes = [...bloco.matchAll(/'([^']+)'/g)].map(m => m[1] ?? '')
  expect(nomes.length).toBeGreaterThan(20)
  expect(nomes.length).toBe(new Set(nomes).size)
})

test('todo efeito que o parser produz tem um case que o trate', () => {
  const produzidos = new Set([...fonteSession.matchAll(/kind: '([^']+)'/g)].map(m => m[1] ?? ''))
  const tratados = new Set(casesDoSwitch(fonteDispatch))
  const foraDoDispatch = new Set(['quit', 'historico', 'none'])
  const orfaos = [...produzidos].filter(k => !tratados.has(k) && !foraDoDispatch.has(k))
  expect(orfaos).toEqual([])
})

test('nenhum case do dispatch fica orfao — case que ninguem alcanca e codigo morto', () => {
  const doParser = [...fonteSession.matchAll(/kind: '([^']+)'/g)].map(m => m[1] ?? '')
  const doProprioDispatch = [...fonteDispatch.matchAll(/kind: '([^']+)'/g)].map(m => m[1] ?? '')
  const alcancaveis = new Set([...doParser, ...doProprioDispatch])
  expect(alcancaveis.size).toBeGreaterThan(10)
  const orfaos = casesDoSwitch(fonteDispatch).filter(c => !alcancaveis.has(c))
  expect(orfaos).toEqual([])
})

test('nenhum comando canonico e apelido de outro — foi assim que /halt, /quit e /project viraram duplicata', () => {
  for (const cmd of COMMANDS) expect(canonico(cmd), cmd).toBe(cmd)
})

test('nenhum apelido serve a dois comandos, e apelido nao repete o principal', () => {
  const vistos = new Set<string>()
  for (const [principal, apelidos] of Object.entries(ALIASES)) {
    for (const a of apelidos) {
      expect(vistos.has(a), `${a} aparece em mais de um comando`).toBe(false)
      expect(a, `${a} e apelido de si mesmo`).not.toBe(principal)
      vistos.add(a)
    }
  }
  expect(vistos.size).toBeGreaterThan(0)
})

test('/new-ask e /new-task sao efeitos DISTINTOS — a colisao dessa classe ja quebrou o parser', () => {
  const perguntar = handle('/new-ask tem ntn-cli instalada?', newSession('org/app'))
  const tarefa = handle('/new-task trocar o selo do header', newSession('org/app'))
  expect(perguntar.effect.kind).toBe('consultar')
  expect(tarefa.effect.kind).toBe('submit')
  expect(perguntar.effect.kind).not.toBe(tarefa.effect.kind)
})

test('/board e /ask sairam da TUI — navegar cards e do painel web', () => {
  for (const morto of ['/board', '/quadro', '/ask', '/responder']) {
    expect(COMMANDS as readonly string[]).not.toContain(morto)
    expect(handle(`${morto} 022 x`, newSession('org/app')).effect.kind, `${morto} ainda parseia`).toBe('error')
  }
})

test('/historico sai da tarefa aberta sem encerrar a sessao', () => {
  const dentro = { ...newSession('org/app'), seguindo: '022' }
  const r = handle('/historico', dentro)
  expect(r.effect.kind).toBe('historico')
  expect(r.state.seguindo).toBe('')
  expect(handle('/history', dentro).effect.kind).toBe('historico')
})

test('todo comando anunciado no /help e no autocompletar existe no parser', () => {
  const semAcao: EffectKind[] = ['error']
  for (const cmd of COMMANDS) {
    const r = handle(`${cmd} 001 x`, newSession('org/app'))
    expect(semAcao).not.toContain(r.effect.kind)
  }
})

test('todo apelido resolve para um comando anunciado', () => {
  for (const [principal, apelidos] of Object.entries(ALIASES)) {
    expect([...COMMANDS] as string[]).toContain(principal)
    for (const a of apelidos) expect(canonico(a)).toBe(principal)
  }
})

test('comando desconhecido avisa em vez de sumir', () => {
  const r = handle('/xpto', newSession('org/app'))
  expect(r.effect.kind).toBe('error')
  expect(r.effect.text).toContain('desconhecido')
})
