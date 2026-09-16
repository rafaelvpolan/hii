import { test, expect, afterAll } from '../apoio/runner.ts'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OllamaProvider } from '../../motor/tomada/harness/ollama.ts'

const dir = mkdtempSync(join(tmpdir(), 'hii-ollama-resposta-'))
const bin = join(dir, 'bin')
mkdirSync(bin)
const antigo = process.env.PATH
process.env.PATH = `${bin}:${antigo}`
afterAll(() => { process.env.PATH = antigo; rmSync(dir, { recursive: true, force: true }) })

async function resposta(corpo: string, codigo = 0, emitir?: (canal: string, texto: string) => void) {
  writeFileSync(join(dir, 'resposta'), corpo)
  writeFileSync(join(bin, 'curl'), `#!/bin/sh\ncat '${join(dir, 'resposta')}'\nexit ${codigo}\n`)
  chmodSync(join(bin, 'curl'), 0o755)
  return new OllamaProvider().run({ prompt: 'teste', cwd: dir, dirs: [], mode: 'readonly', useAgents: false, timeoutMs: 10000, aoEmitir: emitir })
}

test('HTML, JSON vazio e tipos incorretos nao sao uma geracao bem sucedida', async () => {
  for (const corpo of ['<html>502</html>', '{}', 'null', '[]', '{"response":42}']) {
    const r = await resposta(corpo)
    expect(r.ok).toBe(false)
    expect(r.isError).toBe(true)
    expect(r.detail).toContain('documento de geracao valido')
  }
})
test('erro do servidor e status HTTP nao viram sucesso', async () => {
  expect((await resposta('{"error":"model not found"}')).ok).toBe(false)
  expect((await resposta('{"response":"proxy failure"}', 22)).failed).toBe(true)
})
test('geracao valida informa tokens e somente texto publico ao observador', async () => {
  const eventos: string[] = []
  const r = await resposta('{"response":"ola","thinking":"privado","eval_count":8,"prompt_eval_count":2}', 0, (_, s) => eventos.push(s))
  expect(r.ok).toBe(true)
  expect(r.usage.tokens_in).toBe(2)
  expect(r.usage.tokens_out).toBe(8)
  expect(eventos).toEqual(['ola'])
})
test('metricas invalidas e excecao do observador nao corrompem a resposta', async () => {
  const r = await resposta('{"response":"ola","eval_count":-2,"prompt_eval_count":"999"}', 0, () => { throw new Error('UI offline') })
  expect(r.ok).toBe(true)
  expect(r.usage.tokens_in).toBe(0)
  expect(r.usage.tokens_out).toBe(0)
})
