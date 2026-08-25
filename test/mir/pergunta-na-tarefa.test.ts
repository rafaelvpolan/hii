import { test, expect } from '../apoio/runner.ts'
import { FORCA_INSTRUCAO, lerLinhaNaTarefa } from '../../motor/mir/pergunta.ts'
import { handle, newSession, seguir } from '../../motor/mir/sessao.ts'

// Antes, TODO texto digitado com a tarefa aberta virava instrucao anexada ao card:
// "oque esta fazendo no barbeiro?" era gravado como pedido de mudanca e nunca
// respondido — daí a sensacao de apertar ENTER sem nada acontecer.

test('a pergunta REAL do relato e detectada, inclusive com "oque" junto', () => {
  // A grafia "oque" nao e detalhe: e como se digita rapido, e foi o que o pedido
  // real tinha. Deteccao que so funciona com a grafia correta nao serve.
  for (const l of ['o que esta fazendo no barbeiro?', 'oque esta fazendo no barbeiro', 'o q ta rolando', 'pq travou?']) {
    expect(lerLinhaNaTarefa(l).tipo, l).toBe('pergunta')
  }
})

test('PEDIDO em forma de pergunta continua sendo instrucao', () => {
  // O risco conhecido da deteccao automatica. "pode trocar o azul?" e pedido.
  for (const l of ['pode trocar o azul?', 'consegue aumentar a fonte?', 'da pra centralizar isso?', 'vamos mudar o dourado?']) {
    const r = lerLinhaNaTarefa(l)
    expect(r.tipo, l).toBe('instrucao')
    expect(r.motivo).toContain('pedido de acao')
  }
})

test('"!" no comeco FORCA instrucao — escape para quando a heuristica errar', () => {
  const r = lerLinhaNaTarefa(`${FORCA_INSTRUCAO} o que esta feio no header, arruma`)
  expect(r.tipo).toBe('instrucao')
  expect(r.texto, 'a marca nao entra no texto da instrucao').toBe('o que esta feio no header, arruma')
})

test('instrucao normal segue instrucao', () => {
  for (const l of ['troca o dourado para #C9A227', 'usa a paleta do design system', 'remove a borda']) {
    expect(lerLinhaNaTarefa(l).tipo, l).toBe('instrucao')
  }
})

test('a sessao roteia pergunta e instrucao para efeitos DIFERENTES', () => {
  const dentro = seguir(newSession('org/app'), '022')
  expect(handle('oque esta fazendo no barbeiro?', dentro).effect.kind).toBe('situacao')
  expect(handle('troca o dourado', dentro).effect.kind).toBe('instruct')
  expect(handle(`${FORCA_INSTRUCAO} oque esta feio, arruma`, dentro).effect.kind, 'o escape vale no roteamento').toBe('instruct')
})

test('FORA da tarefa, pergunta continua criando tarefa/consulta — nada muda ali', () => {
  const fora = newSession('org/app')
  expect(handle('oque esta fazendo no barbeiro?', fora).effect.kind, 'sem tarefa aberta nao ha situacao a relatar').toBe('submit')
})

test('a pergunta chega ao efeito com o texto, para o motor saber o que foi perguntado', () => {
  const r = handle('por que travou?', seguir(newSession('org/app'), '022'))
  expect(r.effect.id).toBe('022')
  expect(r.effect.text).toBe('por que travou?')
})

// Estas palavras abrem INSTRUCAO em portugues declarativo. Lidas como pergunta, o
// texto era descartado no despacho: perda silenciosa de trabalho, que e o proprio
// defeito que este modulo existe para consertar.
test('REGRESSAO: frase declarativa que comeca com palavra ambigua e INSTRUCAO', () => {
  for (const linha of [
    'tem que trocar o azul pelo verde',
    'esta faltando o botao de salvar',
    'ta quebrado o alinhamento do rodape',
    'quanto ao rodape, usa o dourado',
    'como combinado, usa a paleta nova',
    'que o titulo fique em caixa alta',
    'deu erro no build, refaz',
  ]) {
    expect(lerLinhaNaTarefa(linha).tipo, `"${linha}" e instrucao`).toBe('instrucao')
  }
})

test('a mesma palavra ambigua COM "?" e pergunta, e o motivo ensina o escape', () => {
  for (const linha of ['tem erro no console?', 'quanto gastou?', 'como esta o card?', 'ta rodando?']) {
    const r = lerLinhaNaTarefa(linha)
    expect(r.tipo, linha).toBe('pergunta')
    expect(r.motivo, 'quem quis instruir precisa saber a saida').toContain(FORCA_INSTRUCAO)
  }
})

test('pronome interrogativo forte nao precisa do "?"', () => {
  for (const linha of ['o que esta fazendo no barbeiro', 'oque esta fazendo no barbeiro', 'cade o card', 'qual a cor aplicada']) {
    expect(lerLinhaNaTarefa(linha).tipo, linha).toBe('pergunta')
  }
})
