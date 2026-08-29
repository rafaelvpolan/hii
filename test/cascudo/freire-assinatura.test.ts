import { test, expect } from '../apoio/runner.ts'

const A = await import('../../motor/cascudo/freire/assinatura.ts')

test('mesma causa raiz em cards diferentes da a MESMA assinatura', () => {
  const um = A.assinar({ categoria: 'seguranca', dominio: 'laravel', tipoDeFalha: 'gate_reprovado', causaRaiz: 'PaymentController sem teste de idempotencia' })
  const outro = A.assinar({ categoria: 'seguranca', dominio: 'laravel', tipoDeFalha: 'gate_reprovado', causaRaiz: 'PaymentController sem teste de idempotencia' })
  expect(um).toBe(outro)
})

test('a assinatura e LEGIVEL, nao hash hexadecimal — o candidato e lido por humano', () => {
  const s = A.assinar({ categoria: 'seguranca', dominio: 'laravel', tipoDeFalha: 'gate_reprovado', causaRaiz: 'PaymentController sem teste de idempotencia' })
  expect(s).toContain('seguranca')
  expect(s).toContain('laravel')
  expect(s).not.toMatch(/^[0-9a-f]{8,}$/)
})

test('acento, caixa e espaco nao criam assinaturas diferentes para a mesma causa', () => {
  const a = A.assinar({ categoria: 'seguranca', dominio: 'Laravel', tipoDeFalha: 'gate reprovado', causaRaiz: 'Migração  sem  rollback' })
  const b = A.assinar({ categoria: 'SEGURANCA', dominio: 'laravel', tipoDeFalha: 'gate-reprovado', causaRaiz: 'migracao sem rollback' })
  expect(a).toBe(b)
})

test('causa raiz diferente da assinatura diferente — agrupar demais esconde o problema', () => {
  const a = A.assinar({ categoria: 'build', dominio: 'laravel', tipoDeFalha: 'falhou', causaRaiz: 'composer sem autoload' })
  const b = A.assinar({ categoria: 'build', dominio: 'laravel', tipoDeFalha: 'falhou', causaRaiz: 'migration sem down' })
  expect(a).not.toBe(b)
})

test('campo vazio LANCA — assinatura sem causa raiz agruparia problemas nao relacionados', () => {
  expect(() => A.assinar({ categoria: 'build', dominio: 'x', tipoDeFalha: 'y', causaRaiz: '' })).toThrow('causaRaiz')
  expect(() => A.assinar({ categoria: '', dominio: 'x', tipoDeFalha: 'y', causaRaiz: 'z' })).toThrow('categoria')
})

test('a assinatura serve de nome de arquivo — sem barra, espaco nem caractere de caminho', () => {
  const s = A.assinar({ categoria: 'seguranca', dominio: 'app/Http/Controllers', tipoDeFalha: 'gate reprovado', causaRaiz: '../../etc/passwd' })
  expect(s).not.toContain('/')
  expect(s).not.toContain(' ')
  expect(s).not.toContain('..')
})
