import { test, expect, lerArquivo } from '../apoio/runner.ts'
import { abrirPrompt, anexarInstrucao, montar, prefixoEstavel, conferirPrefixo } from '../../motor/tomada/eco/prefixo.ts'

const PREFIXO = 'SISTEMA: voce edita o worktree.\nSKILLS: laravel-patterns\nTAREFA: corrigir o calculo de comissao'

test('o prefixo sobrevive byte a byte a cada conserto anexado', () => {
  let p = abrirPrompt(PREFIXO)
  const primeira = montar(p)
  p = anexarInstrucao(p, 'CONSERTO 1: o teste de idempotencia falhou')
  p = anexarInstrucao(p, 'CONSERTO 2: o lint reclamou de import nao usado')
  const terceira = montar(p)

  expect(prefixoEstavel(p)).toBe(PREFIXO)
  expect(conferirPrefixo(primeira, terceira).estavel, 'o prefixo mudou — o cache do provedor morre').toBe(true)
  expect(terceira.startsWith(primeira)).toBe(true)
})

test('anexar nao reescreve: o texto anterior continua sendo prefixo do novo', () => {
  let p = abrirPrompt(PREFIXO)
  const passos: string[] = [montar(p)]
  for (let i = 1; i <= 4; i++) {
    p = anexarInstrucao(p, `CONSERTO ${i}`)
    passos.push(montar(p))
  }
  for (let i = 1; i < passos.length; i++) {
    const anterior = passos[i - 1] ?? ''
    const atual = passos[i] ?? ''
    expect(conferirPrefixo(anterior, atual).estavel, `passo ${i} quebrou o prefixo`).toBe(true)
  }
})

test('conferirPrefixo aponta ONDE quebrou — senao o diagnostico e adivinhacao', () => {
  const d = conferirPrefixo('SISTEMA: abc', 'SISTEMA: abd')
  expect(d.estavel).toBe(false)
  expect(d.posicao).toBe(11)
})

test('REGRESSAO encolher o prompt tambem quebra o prefixo, nao so alterar', () => {
  expect(conferirPrefixo('SISTEMA: abcdef', 'SISTEMA: abc').estavel).toBe(false)
})

test('prompt sem sufixo nenhum e exatamente o prefixo — sem \\n sobrando', () => {
  expect(montar(abrirPrompt(PREFIXO))).toBe(PREFIXO)
})

test('a estrutura e imutavel: anexar devolve outro prompt, nao muda o antigo', () => {
  const p = abrirPrompt(PREFIXO)
  const q = anexarInstrucao(p, 'CONSERTO')
  expect(p.sufixos).toHaveLength(0)
  expect(q.sufixos).toHaveLength(1)
})

test('INVARIANTE passoComCrivo usa o prefixo estavel — senao o item 17 e codigo morto', async () => {
  const fonte = await lerArquivo('motor/ciclo/passo-com-gate.ts')
  expect(fonte).toContain('abrirPrompt(instruction)')
  expect(fonte).toContain('anexarInstrucao(prompt')
  expect(fonte, 'voltou a concatenar sufixo solto, que substitui em vez de anexar').not.toContain('instruction + suffix')
})
