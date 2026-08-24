import { test, expect } from 'bun:test'
import { keypress, newInput, colar, expandir, LIMITE_COLA } from '../../motor/mir/tui/input.ts'
import { renderFrame, janelaHorizontal, visibleLen } from '../../motor/mir/tui/layout.ts'

// Dois defeitos de gatilho diario, ambos na superficie que o humano usa a cada
// tarefa: a colagem recuperada do historico e a linha maior que o terminal.

const ENTER = '\r'
const UP = '\x1b[A'

function submeter(state: ReturnType<typeof newInput>): { state: ReturnType<typeof newInput>; linha: string } {
  const r = keypress(state, ENTER)
  return { state: r.state, linha: r.action.kind === 'submit' ? r.action.line : '' }
}

const BLOCO = ['linha 1', 'linha 2', 'linha 3'].join('\n')

test('colagem grande entra como marcador na tela, e expandida no envio', () => {
  const s = colar(newInput(), BLOCO)
  expect(s.buffer).toContain('[colado #1')
  expect(s.buffer).not.toContain('linha 2')
  expect(expandir(s, s.buffer)).toContain('linha 2')
})

test('colagem recuperada do HISTORICO nao volta como o marcador literal', () => {
  const enviado = submeter(colar(newInput(), BLOCO))
  expect(enviado.linha, 'o envio ja funcionava').toContain('linha 2')

  const recuperado = keypress(enviado.state, UP)
  expect(recuperado.state.buffer, 'o historico guardava o marcador e `pastes` era zerado no mesmo passo').not.toContain('[colado #')
  expect(recuperado.state.buffer).toContain('linha 2')

  const reenviado = submeter(recuperado.state)
  expect(reenviado.linha, 'reenviar do historico mandava "[colado #1 · 3 linhas]" como prompt').toContain('linha 3')
  expect(reenviado.linha).not.toContain('[colado #')
})

test('colagem curta de uma linha continua inline, sem marcador', () => {
  const s = colar(newInput(), 'a'.repeat(LIMITE_COLA - 1))
  expect(s.buffer).not.toContain('[colado')
  expect(s.buffer.length).toBe(LIMITE_COLA - 1)
})

const QUADRO = { cols: 40, rows: 24, header: 'h', corpo: [] as string[], prompt: '> ', legenda: 'x', dica: '', rodape: [] as string[] }

function quadroCom(input: string, cursor: number): ReturnType<typeof renderFrame> {
  return renderFrame({ ...QUADRO, input, cursor })
}

test('linha maior que o terminal: o texto sob o CURSOR fica visivel', () => {
  const longa = 'abcdefghij'.repeat(12)
  const fim = quadroCom(longa, longa.length)
  const linhaDoInput = fim.lines.find(l => l.includes('>')) ?? ''
  expect(linhaDoInput, 'truncar no fim escondia justamente o que estava sendo digitado').toContain('abcdefghij'.slice(-4))
})

test('a coluna do cursor nunca passa da largura do terminal', () => {
  const longa = 'x'.repeat(500)
  for (const cursor of [0, 10, 60, 250, 500]) {
    const q = quadroCom(longa, cursor)
    expect(q.cursorCol, `cursor ${cursor} saiu da tela`).toBeLessThanOrEqual(QUADRO.cols)
    expect(q.cursorCol).toBeGreaterThanOrEqual(0)
  }
})

test('nenhuma linha renderizada passa da largura pedida', () => {
  const q = quadroCom('y'.repeat(500), 500)
  for (const l of q.lines) expect(visibleLen(l), JSON.stringify(l.slice(0, 30))).toBeLessThanOrEqual(QUADRO.cols)
})

test('linha que CABE nao rola: cursor no fim continua na posicao natural', () => {
  const curta = 'oi'
  const q = quadroCom(curta, curta.length)
  const semTexto = quadroCom('', 0)
  expect(q.cursorCol - semTexto.cursorCol).toBe(2)
})

test('janelaHorizontal: corta por grafema e mantem o cursor dentro', () => {
  expect(janelaHorizontal('abc', 3, 10)).toEqual({ texto: 'abc', colunaDoCursor: 3, deslocamento: 0 })
  const j = janelaHorizontal('abcdefghij', 10, 4)
  expect(visibleLen(j.texto)).toBeLessThanOrEqual(4)
  expect(j.colunaDoCursor).toBeLessThanOrEqual(4)
})

test('janelaHorizontal nao parte grafema composto no meio', () => {
  const comEmoji = '👨‍👩‍👧'.repeat(6)
  const j = janelaHorizontal(comEmoji, visibleLen(comEmoji), 6)
  expect(visibleLen(j.texto), 'largura visivel nao pode estourar a janela').toBeLessThanOrEqual(6)
  expect(j.texto.endsWith('\u200d'), 'terminou num ZWJ solto: o grafema foi partido').toBe(false)
  expect(j.texto.length, 'janela vazia deixa o cursor "visivel" sobre nada').toBeGreaterThan(0)
})

test('janela nunca fica VAZIA quando ha texto — cursor visivel sobre nada nao e cursor visivel', () => {
  // Largura 1 com grafema de largura DUPLA nao tem janela possivel — nao e defeito.
  for (const largura of [2, 5, 6, 13, 40]) {
    for (const texto of ['x'.repeat(200), 'ab'.repeat(50), '\u{1F468}\u200d\u{1F469}\u200d\u{1F467}'.repeat(6)]) {
      const j = janelaHorizontal(texto, visibleLen(texto), largura)
      expect(j.texto.length, `largura ${largura}`).toBeGreaterThan(0)
      expect(visibleLen(j.texto), `largura ${largura}`).toBeLessThanOrEqual(largura)
      expect(j.colunaDoCursor, `largura ${largura}`).toBeLessThanOrEqual(largura)
    }
  }
})

test('a janela mostra o FIM da linha quando o cursor esta no fim', () => {
  const linha = 'inicio-' + 'meio'.repeat(40) + '-FIM'
  const j = janelaHorizontal(linha, visibleLen(linha), 20)
  expect(j.texto, 'o cursor esta no fim: o fim tem de estar na janela').toContain('FIM')
})

// A primeira versao da rolagem passava o DESLOCAMENTO no parametro `coluna`, o
// que dava a cada linha a janela minima que contem aquela coluna — deslocamentos
// diferentes por linha, com o comentario afirmando o contrario.
test('todas as linhas de entrada rolam com o MESMO deslocamento', () => {
  const linha = 'abcdefghij'.repeat(10)
  const q = renderFrame({ ...QUADRO, input: `${linha}\n${linha}`, cursor: linha.length })
  const doInput = q.lines.filter(l => l.includes('│ ') && /[a-j]{4}/.test(l))
  expect(doInput.length, 'as duas linhas de entrada tem de estar na tela').toBeGreaterThanOrEqual(2)
  const trecho = (l: string): string => (l.match(/[a-j]{6,}/) ?? [''])[0]
  expect(trecho(doInput[0] ?? ''), 'linhas iguais com o mesmo deslocamento mostram o mesmo trecho').toBe(trecho(doInput[1] ?? ''))
})

test('SEM moldura o cursor tambem nao passa da largura — o caminho que o teste anterior nao alcancava', () => {
  for (const n of [30, 36, 37, 38, 40, 200]) {
    const q = renderFrame({ ...QUADRO, legenda: undefined, input: 'x'.repeat(n), cursor: n })
    expect(q.cursorCol, `sem moldura, ${n} chars`).toBeLessThanOrEqual(QUADRO.cols)
    for (const l of q.lines) expect(visibleLen(l)).toBeLessThanOrEqual(QUADRO.cols)
  }
})

test('COM moldura o cursor tambem fica dentro em toda a faixa de comprimento', () => {
  for (const n of [30, 34, 35, 36, 40, 200]) {
    const q = renderFrame({ ...QUADRO, input: 'x'.repeat(n), cursor: n })
    expect(q.cursorCol, `com moldura, ${n} chars`).toBeLessThanOrEqual(QUADRO.cols)
  }
})

test('janelaHorizontal com deslocamento imposto usa ELE, nao um recalculado', () => {
  const linha = 'abcdefghijklmnopqrstuvwxyz'
  const a = janelaHorizontal(linha, 0, 6, 10)
  expect(a.texto).toBe('klmnop')
  const b = janelaHorizontal(linha, 0, 6, 0)
  expect(b.texto).toBe('abcdef')
})

// A sanitizacao era assimetrica: so o caminho inline removia bytes de controle.
// Desde que o historico passou a guardar a versao EXPANDIDA, apertar UP carregava
// sequencia ANSI de uma colagem de saida colorida direto para o buffer RENDERIZADO.
test('colagem GRANDE tambem e sanitizada — o texto expandido vai para a tela agora', () => {
  const sujo = ['linha \x1b[31mvermelha\x1b[0m', 'com \x07sino\x08 e \x00nulo', 'terceira'].join('\n')
  const s = colar(newInput(), sujo)
  const expandido = expandir(s, s.buffer)
  expect(expandido, 'ESC de sequencia ANSI nao pode chegar ao buffer renderizado').not.toContain('\x1b')
  expect(expandido).not.toContain('\x07')
  expect(expandido).not.toContain('\x00')
  expect(expandido, 'a quebra de linha e o conteudo tem de sobreviver').toContain('terceira')
  expect(expandido.split('\n').length).toBe(3)
})

test('colagem inline continua sanitizada, e tab sobrevive nos dois caminhos', () => {
  const s = colar(newInput(), 'a\tb\x01c')
  expect(s.buffer).toBe('a\tb c'.replace(' ', ''))
  const grande = colar(newInput(), `col1\tcol2\x01\nlinha2`)
  expect(expandir(grande, grande.buffer)).toContain('col1\tcol2')
})


test('controles C1 (U+0080-U+009F) tambem sao removidos — U+009B e CSI de um byte', () => {
  const CSI = String.fromCharCode(0x9b)
  const NEL = String.fromCharCode(0x85)
  const comC1 = `linha${CSI}31m vermelha${NEL} e mais`
  const inline = colar(newInput(), comC1)
  expect(inline.buffer).not.toContain(CSI)
  expect(inline.buffer).not.toContain(NEL)
  const grande = colar(newInput(), `${comC1}\noutra linha\noutra`)
  const expandido = expandir(grande, grande.buffer)
  expect(expandido, 'C1 chegando ao buffer renderizado e ao prompt da IA').not.toContain(CSI)
  expect(expandido).toContain('vermelha')
})

test('linha do tamanho EXATO da janela nao salta um passo inteiro de rolagem', () => {
  // Antes: com `minimo` = 1 o arredondamento para o passo (8) escondia 8 colunas
  // que caberiam e deixava branco a direita.
  const j = janelaHorizontal('x'.repeat(20), 20, 20)
  // Uma coluna fica para o cursor (ele esta DEPOIS do ultimo caractere), entao 19
  // de 20 e o maximo correto. O defeito era saltar o passo inteiro: 8 colunas
  // escondidas e 8 em branco a direita.
  expect(j.deslocamento, 'salto de 8 quando 1 bastava').toBe(1)
  expect(visibleLen(j.texto), 'a janela tem de ficar cheia menos a coluna do cursor').toBe(19)
  expect(j.colunaDoCursor).toBe(19)

  // Com o cursor NO FIM de uma linha longa, a janela fica ancorada no fim: o
  // deslocamento acompanha o cursor de um em um, que e rolagem suave e nao tremor.
  // O passo importa no meio da linha, onde o cursor nao esta na borda.
  const noFim = janelaHorizontal('y'.repeat(200), 200, 20)
  expect(visibleLen(noFim.texto), 'a janela tem de estar cheia').toBe(19)
  const noMeio = janelaHorizontal('y'.repeat(200), 100, 20)
  expect(noMeio.deslocamento % 8, 'no meio da linha o deslocamento anda em passos, para o texto nao tremer').toBe(0)
  expect(visibleLen(noMeio.texto)).toBe(20)
})
