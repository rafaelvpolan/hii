import { test, expect } from '../apoio/runner.ts'
import { execFileSync } from 'node:child_process'
import { herdarEnvsAntigas } from '../../motor/cordel/alicerce/config.ts'

test('o motor le HII_*; HICODE_* antigo e herdado UMA vez com aviso, e nao sobrescreve HII_ ja definido', () => {
  const env: NodeJS.ProcessEnv = { HICODE_POLL_MS: '7000', HICODE_EVAL: 'off', HII_EVAL: 'on', OUTRA: 'x' }
  const avisos: string[] = []
  const herdadas = herdarEnvsAntigas(env, l => avisos.push(l))
  expect(herdadas).toEqual(['HICODE_POLL_MS'])
  expect(env.HII_POLL_MS).toBe('7000')
  expect(env.HII_EVAL, 'HII_ definido ganha do HICODE_ antigo').toBe('on')
  expect(avisos.length).toBe(1)
  expect(avisos[0]).toContain('HICODE_POLL_MS')
  expect(avisos[0]).toContain('HII_*')
  expect(herdarEnvsAntigas({ HII_X: '1' }, l => avisos.push(l))).toEqual([])
  expect(avisos.length, 'sem env antiga, sem aviso').toBe(1)
})

test('INVARIANTE: nenhum arquivo versionado do motor ainda le HICODE_ — o prefixo antigo so existe no shim de heranca', () => {
  const saida = execFileSync('git', ['grep', '-l', 'HICODE_', '--', 'motor', 'bin', 'runner.ts', 'scripts', 'test', 'config'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').filter(Boolean)
  expect(saida.sort()).toEqual(['motor/cordel/alicerce/config.ts', 'test/cordel/envs-prefixo-hii.test.ts'])
})
