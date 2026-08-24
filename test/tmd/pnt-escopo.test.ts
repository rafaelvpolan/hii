import { test, expect } from 'bun:test'
import { lerEscopo } from '../../motor/tmd/pnt/estado.ts'

test('escopo dinamico e reconhecido', () => {
  expect(lerEscopo('Scope: Dynamic config (from CLI flags)')).toBe('dinamico')
})

test('escopo persistente e reconhecido', () => {
  expect(lerEscopo('Scope: User config (~/.claude.json)')).toBe('persistente')
  expect(lerEscopo('Scope: Project config')).toBe('persistente')
})

test('REGRESSAO saida irreconhecivel NAO vira persistente — fail-closed', () => {
  expect(lerEscopo('')).toBe('nao-verificavel')
  expect(lerEscopo('formato novo do cli, sem a palavra esperada')).toBe('nao-verificavel')
  expect(lerEscopo('Error: server not found')).toBe('nao-verificavel')
})

test('REGRESSAO saida truncada no meio do campo nao e promovida a persistente', () => {
  expect(lerEscopo('Server: notion\nScope:')).toBe('nao-verificavel')
})
