import { test, expect } from '../apoio/runner.ts'
import { resolverResposta, cardsPerguntando } from '../../motor/mir/responder.ts'
import { renderPergunta, quebrar } from '../../motor/mir/render/clarify.ts'
import type { ClarifyQuestion, Fields } from '../../motor/cdl/tipos.ts'

const pergunta: ClarifyQuestion = {
  q: 'Qual selo remover?',
  options: ['Só o do header', 'Só o do hero', 'Ambos'],
  recommended: 'Só o do header',
}

test('numero escolhe a opcao pela ordem mostrada', () => {
  expect(resolverResposta(pergunta, '2')).toBe('Só o do hero')
  expect(resolverResposta(pergunta, ' 3 ')).toBe('Ambos')
})

test('enter vazio aceita o sugerido', () => {
  expect(resolverResposta(pergunta, '')).toBe('Só o do header')
  expect(resolverResposta(pergunta, 'r')).toBe('Só o do header')
})

test('texto livre vira a resposta', () => {
  expect(resolverResposta(pergunta, 'nenhum, deixe os dois')).toBe('nenhum, deixe os dois')
})

test('numero fora da lista nao vira resposta silenciosa', () => {
  expect(resolverResposta(pergunta, '9')).toBe('')
  expect(resolverResposta(pergunta, '0')).toBe('')
})

test('sem recomendado, enter cai na primeira opcao', () => {
  expect(resolverResposta({ ...pergunta, recommended: '' }, '')).toBe('Só o do header')
})

function card(over: Partial<Fields>): Fields {
  return { id: '1', title: 't', status: 'READY', repo: 'org/app', ...over }
}

test('so lista cards em CLARIFY, e so do repo atual', () => {
  const cards = [
    card({ id: '022', status: 'CLARIFY' }),
    card({ id: '023', status: 'EXECUTING' }),
    card({ id: '024', status: 'CLARIFY', repo: 'org/outro' }),
  ]
  expect(cardsPerguntando(cards, 'org/app')).toEqual(['022'])
  expect(cardsPerguntando(cards)).toEqual(['022', '024'])
})

test('render numera as opcoes e marca a sugerida', () => {
  const t = renderPergunta({ id: '022', titulo: 'x', perguntas: [pergunta], indice: 0, atual: pergunta, origem: 'clarify' as const }).join('\n')
  expect(t).toContain('1  Só o do header')
  expect(t).toContain('2  Só o do hero')
  expect(t).toContain('← sugerido')
  expect(t).not.toContain('1/1')
})

test('render mostra o passo quando ha mais de uma pergunta', () => {
  const t = renderPergunta({ id: '022', titulo: 'x', perguntas: [pergunta, pergunta], indice: 1, atual: pergunta, origem: 'clarify' as const }).join('\n')
  expect(t).toContain('(2/2)')
})

test('render sem cor nao emite escape ANSI', () => {
  const t = renderPergunta({ id: '022', titulo: 'x', perguntas: [pergunta], indice: 0, atual: pergunta, origem: 'clarify' as const }).join('\n')
  expect(t).not.toContain('\x1b[')
})

test('pergunta longa quebra em linhas dentro da largura', () => {
  const linhas = quebrar('a'.repeat(3) + ' palavra '.repeat(30), 40)
  expect(linhas.every(l => l.length <= 40)).toBe(true)
  expect(linhas.length).toBeGreaterThan(1)
})

import { renderRespondidas } from '../../motor/mir/render/clarify.ts'

test('mostra as decisoes ja tomadas, pergunta e resposta', () => {
  const t = renderRespondidas('022', [
    { q: 'Qual selo remover?', answer: 'Só o do header' },
    { q: 'Sem resposta ainda', answer: '' },
  ]).join('\n')
  expect(t).toContain('Qual selo remover?')
  expect(t).toContain('→ Só o do header')
  expect(t).not.toContain('Sem resposta ainda')
})

test('card sem pergunta nem resposta diz isso', () => {
  expect(renderRespondidas('030', []).join('')).toContain('nao tem pergunta nem resposta')
})

import { renderOpcoesRodape } from '../../motor/mir/render/clarify.ts'

const pend = { id: '022', titulo: 'x', perguntas: [pergunta], indice: 0, atual: pergunta, origem: 'clarify' as const }

// Por CONTEUDO, e nao por indice: entre o cabecalho e as opcoes agora vem a pergunta
// quebrada em linhas, e o numero delas depende do tamanho da pergunta e da largura.
// Ancorar em `linhas[2]` amarrava o teste a um layout, nao ao comportamento.
test('rodape numera as opcoes e marca a escolhida pela seta', () => {
  const linhas = renderOpcoesRodape(pend, { selecionado: 'op:2', width: 78 })
  expect(linhas[0]).toContain('#022 pergunta')
  const marcadas = linhas.filter(l => l.startsWith('›'))
  expect(marcadas.length, 'uma opcao marcada, e so uma').toBe(1)
  expect(marcadas[0]).toContain('2')
  expect(marcadas[0]).toContain('Só o do hero')
})

test('rodape aponta a opcao sugerida', () => {
  expect(renderOpcoesRodape(pend, { selecionado: '', width: 78 }).join('\n')).toContain('sugerido')
})

test('rodape mostra o passo quando ha mais de uma pergunta', () => {
  const dois = { ...pend, perguntas: [pergunta, pergunta], indice: 1 }
  expect(renderOpcoesRodape(dois, { selecionado: '', width: 78 })[0]).toContain('(2/2)')
})

// A pergunta longa e QUEBRADA, e nao mais recortada: recortar escondia justamente o
// que a pergunta pergunta. O que continua valendo e a linha caber no quadro — e a
// palavra sem espaco (caminho, URL, identificador) tem de ser partida na forca,
// senao quebrar por espaco nao resolve nada.
test('pergunta longa cabe no rodape sem ser truncada', () => {
  const longa = { ...pergunta, q: 'q'.repeat(300) }
  const linhas = renderOpcoesRodape({ ...pend, atual: longa }, { selecionado: '', width: 60 })
  for (const l of linhas) expect(l.length, `linha estourou: ${l.length}`).toBeLessThanOrEqual(70)
  const comTexto = linhas.filter(l => l.includes('qqq'))
  expect(comTexto.length, 'a pergunta ocupa varias linhas em vez de sumir num "…"').toBeGreaterThan(1)
})

test('pergunta com espacos e quebrada por palavra, e o FIM dela aparece', () => {
  const longa = { ...pergunta, q: 'o helper jsonLd em seo.test.ts tipa data como any implicito via JSON.parse — isso foi conferido no build real, ou so lido?' }
  const linhas = renderOpcoesRodape({ ...pend, atual: longa }, { selecionado: '', width: 80 })
  expect(linhas.join(' '), 'o fim e onde mora a pergunta de verdade').toContain('ou so lido?')
})

test('sem cor nao emite escape ANSI', () => {
  expect(renderOpcoesRodape(pend, { selecionado: 'op:1', color: false }).join('')).not.toContain('\x1b[')
})
