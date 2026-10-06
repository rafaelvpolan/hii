import { test, expect } from '../apoio/runner.ts'
import { motivoDaReprovacao } from '../../motor/oswaldo/orquestracao/evidencias.ts'
import type { Evidencia } from '../../motor/oswaldo/orquestracao/evidencias.ts'

function evidencia(criterio: string, parcial: Partial<Evidencia>): Evidencia {
  return { criterio, estado: 'reprovado', obrigatorio: true, comando: ['npm', 'run', criterio], exitCode: 1, sinal: '', timeout: false, falha: 'codigo-saida', duracaoMs: 10, saida: '', ...parcial }
}

test('ferramenta do projeto ausente vira dica de instalar dependencias', () => {
  const motivo = motivoDaReprovacao([
    evidencia('build', { exitCode: 127, saida: 'sh: 1: vue-tsc: not found' }),
    evidencia('test', { exitCode: 127, saida: 'sh: 1: vitest: not found' }),
  ])
  expect(motivo).toContain('build')
  expect(motivo).toContain('test')
  expect(motivo).toContain('dependencias do projeto nao instaladas')
})

test('falha comum mostra o criterio e o codigo de saida', () => {
  const motivo = motivoDaReprovacao([evidencia('test', { exitCode: 1, saida: '1 failed' }), evidencia('lint', { estado: 'aprovado', exitCode: 0 })])
  expect(motivo).toBe('test: saiu com codigo 1')
})

test('criterio opcional reprovado nao entra no motivo', () => {
  expect(motivoDaReprovacao([evidencia('lint', { obrigatorio: false })])).toBe('')
})
