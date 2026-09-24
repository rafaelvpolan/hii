import { test, expect, beforeEach, afterEach } from '../apoio/runner.ts'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { OllamaProvider } from '../../motor/tomada/harness/ollama.ts'

let dir = '', bin = '', respostas = '', requisicoes = ''
let pathAnterior: string | undefined
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hii-ollama-agentivo-'))
  bin = join(dir, 'bin'); mkdirSync(bin)
  respostas = join(dir, 'respostas'); requisicoes = join(dir, 'requisicoes')
  pathAnterior = process.env.PATH
  process.env.PATH = `${bin}:${pathAnterior ?? ''}`
  process.env.HII_OLLAMA_AGENTIC = '1'
  writeFileSync(join(bin, 'curl'), `#!/bin/sh
printf '%s\n' "$@" >> '${requisicoes}'
linha=$(sed -n '1p' '${respostas}')
sed '1d' '${respostas}' > '${respostas}.tmp'
mv '${respostas}.tmp' '${respostas}'
printf '%s\n' "$linha"
`)
  chmodSync(join(bin, 'curl'), 0o755)
})
afterEach(() => {
  if (pathAnterior === undefined) delete process.env.PATH; else process.env.PATH = pathAnterior
  delete process.env.HII_OLLAMA_AGENTIC
  rmSync(join(dir, '..', `${dir.split('/').pop()}-fora.txt`), { force: true })
  rmSync(dir, { recursive: true, force: true })
})

function respostasDaIa(...itens: object[]): void { writeFileSync(respostas, itens.map(x => JSON.stringify(x)).join('\n') + '\n') }
function pedido(modo: 'edit' | 'readonly' = 'edit') {
  return { prompt: 'ajuste arquivo.txt', cwd: dir, dirs: [dir], mode: modo, useAgents: false, timeoutMs: 10000 }
}

test('modelo sem tools e recusado antes de qualquer efeito', async () => {
  writeFileSync(join(dir, 'arquivo.txt'), 'antes')
  respostasDaIa({ capabilities: ['completion'] })
  const r = await new OllamaProvider().run(pedido())
  expect(r.ok).toBe(false)
  expect(r.detail).toContain('nao declara capacidade tools')
  expect(readFileSync(join(dir, 'arquivo.txt'), 'utf8')).toBe('antes')
  expect(readFileSync(requisicoes, 'utf8')).not.toContain('/api/chat')
})

test('loop executa substituicao validada e so conclui com resposta final', async () => {
  writeFileSync(join(dir, 'arquivo.txt'), 'antes')
  const eventos: string[] = []
  respostasDaIa(
    { capabilities: ['completion', 'tools'] },
    { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'replace_text', arguments: { path: 'arquivo.txt', old_text: 'antes', new_text: 'depois' } } }] }, prompt_eval_count: 3, eval_count: 2 },
    { message: { role: 'assistant', content: 'feito' }, prompt_eval_count: 4, eval_count: 1 },
  )
  const r = await new OllamaProvider().run({ ...pedido(), aoEvento: e => eventos.push(e.tipo + ('ferramenta' in e ? ':' + e.ferramenta : '')) })
  expect(r.ok).toBe(true)
  expect(r.text).toBe('feito')
  expect(r.usage.tokens_in).toBe(7)
  expect(r.usage.tokens_out).toBe(3)
  expect(readFileSync(join(dir, 'arquivo.txt'), 'utf8')).toBe('depois')
  expect(eventos).toEqual(['modelo_verificado', 'inferencia_inicio', 'inferencia_fim', 'ferramenta_inicio:replace_text', 'ferramenta_fim:replace_text', 'inferencia_inicio', 'inferencia_fim'])
})

test('multiplas ferramentas da mesma resposta sao serializadas antes da proxima inferencia', async () => {
  writeFileSync(join(dir, 'a.txt'), 'A0')
  writeFileSync(join(dir, 'b.txt'), 'B0')
  respostasDaIa(
    { capabilities: ['tools'] },
    { message: { role: 'assistant', content: '', tool_calls: [
      { function: { name: 'replace_text', arguments: { path: 'a.txt', old_text: 'A0', new_text: 'A1' } } },
      { function: { name: 'replace_text', arguments: { path: 'b.txt', old_text: 'B0', new_text: 'B1' } } },
    ] } },
    { message: { role: 'assistant', content: 'duas alteracoes concluidas' } },
  )
  const ferramentas: string[] = []
  const r = await new OllamaProvider().run({ ...pedido(), aoEvento: e => { if ('ferramenta' in e) ferramentas.push(e.tipo + ':' + e.ferramenta) } })
  expect(r.ok).toBe(true)
  expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('A1')
  expect(readFileSync(join(dir, 'b.txt'), 'utf8')).toBe('B1')
  expect(ferramentas).toEqual(['ferramenta_inicio:replace_text', 'ferramenta_fim:replace_text', 'ferramenta_inicio:replace_text', 'ferramenta_fim:replace_text'])
})

test('readonly, traversal e ferramenta desconhecida falham sem alterar arquivo', async () => {
  const fora = `../${dir.split('/').pop()}-fora.txt`
  writeFileSync(join(dir, 'real.txt'), 'interno')
  symlinkSync('real.txt', join(dir, 'atalho.txt'))
  for (const [modo, chamada, motivo] of [
    ['readonly', { function: { name: 'replace_text', arguments: { path: 'arquivo.txt', old_text: 'antes', new_text: 'depois' } } }, 'somente leitura'],
    ['edit', { function: { name: 'read_file', arguments: { path: fora } } }, 'traversal recusado'],
    ['edit', { function: { name: 'read_file', arguments: { path: 'C:\\segredo.txt' } } }, 'relativo ao workspace'],
    ['edit', { function: { name: 'read_file', arguments: { path: 'atalho.txt' } } }, 'symlink recusado'],
    ['edit', { function: { name: 'shell', arguments: { path: 'arquivo.txt' } } }, 'desconhecida'],
  ] as const) {
    writeFileSync(join(dir, 'arquivo.txt'), 'antes')
    writeFileSync(join(dir, fora), 'segredo')
    respostasDaIa({ capabilities: ['tools'] }, { message: { role: 'assistant', content: '', tool_calls: [chamada] } })
    const r = await new OllamaProvider().run(pedido(modo))
    expect(r.ok, motivo).toBe(false)
    expect(r.detail, motivo).toContain(motivo)
    expect(readFileSync(join(dir, 'arquivo.txt'), 'utf8')).toBe('antes')
  }
})
