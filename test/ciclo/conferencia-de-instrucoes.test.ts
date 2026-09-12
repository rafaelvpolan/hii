import { test, expect } from '../apoio/runner.ts'
import { atendidasDe, marcarAtendidas, parseConferencia, pendentesDoCard, instrucoesDoCard, listaNumerada, CAMPO_ATENDIDAS } from '../../motor/ciclo/crivo/conferencia-de-instrucoes.ts'
import { pedidoDeRefacao } from '../../motor/ciclo/corrigir.ts'
import type { Card } from '../../motor/cordel/index.ts'

const CORPO = '## Objetivo\nsubir o preview\n\n## Instrucoes\n1. ajustar o menu mobile\n2. remover o efeito atras da logo\n3. corrigir o z-index dos cards\n\n## Log de Estado\n2026-09-10T00:02:24Z CREATED\n'

function card(fm: Record<string, string> = {}): Card {
  return { fm: { id: '005', ...fm }, body: CORPO, file: '005-preview.md', order: [] }
}

test('as instrucoes numeradas saem do corpo com o numero que o humano ve', () => {
  expect(instrucoesDoCard(card())).toEqual([
    { numero: 1, texto: 'ajustar o menu mobile' },
    { numero: 2, texto: 'remover o efeito atras da logo' },
    { numero: 3, texto: 'corrigir o z-index dos cards' },
  ])
  expect(listaNumerada(instrucoesDoCard(card()))).toBe('1. ajustar o menu mobile\n2. remover o efeito atras da logo\n3. corrigir o z-index dos cards')
})

test('pendentes sao as que o frontmatter ainda nao marca como atendidas', () => {
  expect(pendentesDoCard(card()).map(i => i.numero)).toEqual([1, 2, 3])
  expect(pendentesDoCard(card({ [CAMPO_ATENDIDAS]: '1,3' })).map(i => i.numero)).toEqual([2])
  expect(pendentesDoCard(card({ [CAMPO_ATENDIDAS]: '1,2,3' }))).toEqual([])
})

test('o ledger de atendidas acumula, ordena e ignora lixo', () => {
  expect([...atendidasDe({ [CAMPO_ATENDIDAS]: '3, 1,x,,0' })]).toEqual([3, 1])
  expect(marcarAtendidas('3', [1, 2])).toBe('1,2,3')
  expect(marcarAtendidas('', [])).toBe('')
  expect(marcarAtendidas('2', [2])).toBe('2')
})

test('parseConferencia le o ultimo JSON com itens e completa o que o crivo calou como NAO atendida', () => {
  const texto = 'analisando...\n{"itens":[{"n":1,"atendida":true,"motivo":"menu-toggle em App.vue"},{"n":"3","atendida":"false","motivo":"nenhum z-index alterado"}]}'
  expect(parseConferencia(texto, [1, 2, 3])).toEqual([
    { numero: 1, atendida: true, motivo: 'menu-toggle em App.vue' },
    { numero: 2, atendida: false, motivo: 'o crivo nao se pronunciou sobre esta instrucao' },
    { numero: 3, atendida: false, motivo: 'nenhum z-index alterado' },
  ])
})

test('parseConferencia devolve null sem JSON de itens — inconclusivo, nao "tudo certo"', () => {
  expect(parseConferencia('nao consegui avaliar', [1])).toBe(null)
  expect(parseConferencia('{"verdict":"APPROVED"}', [1])).toBe(null)
})

test('o pedido de refacao lista TODAS as pendentes, cobra as que faltaram e avisa das novas', () => {
  const pendentes = instrucoesDoCard(card())
  const primeiro = pedidoDeRefacao('ajustar o menu mobile', pendentes, [], 0)
  expect(primeiro).toContain('TODAS as instruções')
  expect(primeiro).toContain('1. ajustar o menu mobile')
  expect(primeiro).toContain('3. corrigir o z-index dos cards')
  expect(primeiro).not.toContain('CONFERÊNCIA')
  const segundo = pedidoDeRefacao('', pendentes.slice(2), [{ numero: 3, atendida: false, motivo: 'nenhum z-index alterado' }], 1)
  expect(segundo).toContain('#3 (nenhum z-index alterado)')
  expect(segundo).toContain('1 instrução(ões) nova(s)')
  expect(segundo).not.toContain('1. ajustar o menu mobile')
})

test('sem instrucoes numeradas o pedido segue o formato antigo, com o texto da correcao', () => {
  expect(pedidoDeRefacao('refaca isso', [], [], 0)).toContain('atendendo exatamente: "refaca isso"')
})
