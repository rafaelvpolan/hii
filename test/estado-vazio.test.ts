import { test, expect } from 'bun:test'
import { avisoDeEstadoVazio } from '../motor/mir/estado-vazio'

test('estado com cards nao gera aviso nenhum', () => {
  expect(avisoDeEstadoVazio({ vazio: false, apontadoPorEnv: false, caminho: '/x/cards', outroEstado: '' })).toEqual([])
})

test('vazio com OUTRO estado achado diz onde estao os cards e o que exportar', () => {
  const l = avisoDeEstadoVazio({ vazio: true, apontadoPorEnv: false, caminho: '/hii/cards', outroEstado: '/hicode/cards' })
  expect(l.join(' ')).toContain('/hicode/cards')
  expect(l.join(' ')).toContain('HICODE_CARDS_DIR')
})

test('vazio com a env apontando culpa o caminho da env, nao inventa vizinho', () => {
  const l = avisoDeEstadoVazio({ vazio: true, apontadoPorEnv: true, caminho: '/errado/cards', outroEstado: '/hicode/cards' })
  expect(l.join(' ')).toContain('/errado/cards')
  expect(l.join(' ')).not.toContain('/hicode/cards')
})

test('vazio sem vizinho nenhum convida a escrever a primeira tarefa', () => {
  const l = avisoDeEstadoVazio({ vazio: true, apontadoPorEnv: false, caminho: '/novo/cards', outroEstado: '' })
  expect(l).toHaveLength(1)
  expect(l[0]).toContain('primeira tarefa')
})
