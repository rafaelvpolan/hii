import { test, expect } from 'bun:test'
import { renderFleet } from '../motor/mir/render/fleet'
import { isActive, waitsHuman, phaseLabel } from '../motor/mir/render/phases'
import type { Fields } from '../motor/cdl'

function card(over: Partial<Fields>): Fields {
  return { id: '1', title: 't', status: 'READY', ...over }
}

test('phases: classifica ativo, esperando humano e rotulo', () => {
  expect(isActive('EXECUTING')).toBe(true)
  expect(isActive('URL')).toBe(false)
  expect(waitsHuman('URL')).toBe(true)
  expect(waitsHuman('CLARIFY')).toBe(true)
  expect(phaseLabel('TESTS_GREEN')).toBe('Polir')
})

test('REGRESSAO: WAITING e ativo (motor retomando sozinho) mas nao espera humano (nao ha comando a digitar)', () => {
  expect(isActive('WAITING')).toBe(true)
  expect(waitsHuman('WAITING')).toBe(false)
})

test('REGRESSAO: fleet conta card WAITING como ativo e mostra marca propria (nao fica invisivel)', () => {
  const t = renderFleet([card({ id: '7', status: 'WAITING' })], { repo: 'org/app', daemon: 'online (pid 1)' })
  expect(t).toContain('1 ativo(s)')
  expect(t).toContain('#007')
  expect(t).toContain('aguardando')
})

test('fleet: conta ativos e esperando separadamente', () => {
  const t = renderFleet([
    card({ id: '1', status: 'EXECUTING' }),
    card({ id: '2', status: 'URL' }),
    card({ id: '3', status: 'MERGED' }),
  ], { repo: 'org/app', daemon: 'online (pid 1)' })
  expect(t).toContain('1 ativo(s)')
  expect(t).toContain('1 esperando voce')
  expect(t).toContain('org/app')
})

test('fleet: card terminal nao aparece na faixa', () => {
  const t = renderFleet([card({ id: '9', status: 'MERGED' })], {})
  expect(t).not.toContain('#009')
})

test('fleet: HALTED e PAUSED aparecem com marca propria', () => {
  const t = renderFleet([card({ id: '4', status: 'HALTED' }), card({ id: '5', status: 'PAUSED' })], {})
  expect(t).toContain('parou')
  expect(t).toContain('pausado')
})

test('fleet sem cor nao emite escape ANSI', () => {
  const t = renderFleet([card({ id: '1', status: 'EXECUTING' })], { color: false })
  expect(t).not.toContain('\x1b[')
})

test('fleet vazio ainda mostra cabecalho e daemon', () => {
  const t = renderFleet([], { repo: 'org/app', daemon: 'offline' })
  expect(t).toContain('daemon offline')
  expect(t).toContain('0 ativo(s)')
})
