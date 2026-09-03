import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const CARDS = mkdtempSync(join(tmpdir(), 'hicode-refconf-'))
process.env.HICODE_CARDS_DIR = CARDS

const { createCard, readCard } = await import('../../motor/cordel/store.ts')
const { refRefusalLine, markRefsRefused } = await import('../../motor/quilombo/alfandega/confianca.ts')
const { refuse } = await import('../../motor/quilombo/alfandega/url-guard.ts')

afterAll(() => rmSync(CARDS, { recursive: true, force: true }))

function card(): string {
  return createCard({ title: 'algo', status: 'EXECUTING', repo: 'org/repo' }, '## Objetivo\nalgo\n')
}

const RECUSA = refuse('host-bloqueado', 'rede privada RFC1918')

test('refRefusalLine formata a recusa com motivo e detalhe clipados', () => {
  const l = refRefusalLine('http://exemplo.com/img.png', RECUSA)
  expect(l).toContain('referencia recusada: http://exemplo.com/img.png (host-bloqueado)')
  expect(l).toContain('rede privada RFC1918')
  expect(l).toContain('implementando sem ela')
})

test('refRefusalLine achata quebras de linha da origem — uma recusa nunca injeta linhas no diario', () => {
  const l = refRefusalLine('http://a.com/x\nrm -rf /\ty', RECUSA)
  expect(l.split('\n')).toHaveLength(1)
})

test('refusal.reason vem de uniao fechada — "motivo vazio" e irrepresentavel em TS', () => {
  // O rascunho generativo pediu cenario com reason ""; o tipo RefusalReason e
  // uniao fechada, entao o typecheck barra o caso — a protecao e estatica,
  // nao de runtime. O que se testa e o formato com um motivo real.
  expect(refRefusalLine('url', refuse('resposta-vazia', 'corpo 0 bytes'))).toContain('(resposta-vazia) — corpo 0 bytes')
})

test('markRefsRefused sem id nao toca em nada (nem com recusa na lista)', () => {
  // id vazio e early return — se nao fosse, patchCard('', ...) gravaria lixo.
  expect(() => markRefsRefused('', [{ source: 'u', path: '', refusal: RECUSA }])).not.toThrow()
})

test('markRefsRefused ignora outcomes sem refusal e anota cada recusa no diario do card', () => {
  const id = card()
  markRefsRefused(id, [
    { source: 'http://ok.com/a.png', path: '/tmp/a', refusal: null },
    { source: 'http://interno.local/b.png', path: '', refusal: RECUSA },
    { source: 'http://169.254.169.254/meta', path: '', refusal: refuse('host-bloqueado', 'metadados de nuvem') },
  ])
  const body = readCard(id)?.body ?? ''
  expect(body).not.toContain('ok.com')
  expect(body).toContain('interno.local/b.png (host-bloqueado)')
  expect(body).toContain('169.254.169.254/meta (host-bloqueado)')
})
