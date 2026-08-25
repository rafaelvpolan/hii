import { test, expect } from '../apoio/runner.ts'
import { openScreen, pinturaDiferencial, frameToAnsi } from '../../motor/mir/tui/screen.ts'
import { renderFrame } from '../../motor/mir/tui/layout.ts'
import type { Terminal } from '../../motor/mir/tui/screen.ts'
import type { FrameInput } from '../../motor/mir/tui/layout.ts'

function quadro(over: Partial<FrameInput> = {}): ReturnType<typeof renderFrame> {
  return renderFrame({
    rows: 12, cols: 60, header: 'hii   daemon online', corpo: ['  a', '  b', '  c'],
    input: '', cursor: 0, dica: '', prompt: '› ', rodape: [], ...over,
  })
}

function bancada(): { term: Terminal; escrito: () => string; zerar: () => void } {
  let escrito = ''
  const term: Terminal = {
    write: (s) => { escrito += s },
    rows: () => 12,
    cols: () => 60,
    onResize: () => {}, offResize: () => {},
    onKey: () => {}, offKey: () => {},
    setRaw: () => {},
  }
  return { term, escrito: () => escrito, zerar: () => { escrito = '' } }
}

const conteudo = (corpo: string[]): Omit<FrameInput, 'rows' | 'cols'> => ({
  header: 'hii   daemon online', corpo, input: '', cursor: 0, dica: '', prompt: '› ', rodape: [],
})

test('sem quadro anterior, pinta a tela inteira', () => {
  const f = quadro()
  expect(pinturaDiferencial(f, [])).toBe(frameToAnsi(f))
})

test('quadro identico ao anterior nao reescreve linha nenhuma', () => {
  const f = quadro()
  const pintura = pinturaDiferencial(f, f.lines)
  expect(pintura).toBe(`\x1b[${f.cursorRow};${f.cursorCol}H`)
  expect(pintura).not.toContain('hii')
})

test('PISCA-PISCA: mudando so o corpo, o cabecalho nao e reescrito', () => {
  const antes = quadro({ corpo: ['  ⠋ rodando', '  b', '  c'] })
  const depois = quadro({ corpo: ['  ⠙ rodando', '  b', '  c'] })
  const pintura = pinturaDiferencial(depois, antes.lines)
  expect(pintura).toContain('⠙ rodando')
  expect(pintura).not.toContain('hii   daemon online')
  expect(pintura.match(/\x1b\[\d+;1H/g)?.length).toBe(1)
})

test('quadro que encolhe limpa as linhas que sobraram', () => {
  const antes = quadro()
  const depois = { ...antes, lines: antes.lines.slice(0, 3) }
  const pintura = pinturaDiferencial(depois, antes.lines)
  expect(pintura).toContain('\x1b[K')
  expect(pintura.match(/\x1b\[\d+;1H/g)?.length).toBe(antes.lines.length - 3)
})

test('na tela, animacao no corpo custa muito menos que a pintura inteira', () => {
  const b = bancada()
  const tela = openScreen(b.term)
  tela.draw(conteudo(['  ⠋ rodando', '  estavel', '  estavel 2']))
  const inteira = b.escrito().length
  b.zerar()
  tela.draw(conteudo(['  ⠙ rodando', '  estavel', '  estavel 2']))
  const animacao = b.escrito()
  expect(animacao.length).toBeLessThan(inteira / 4)
  expect(animacao).not.toContain('daemon online')
  b.zerar()
  tela.draw(conteudo(['  ⠙ rodando', '  estavel', '  estavel 2']))
  expect(b.escrito()).toBe('')
  tela.close()
})

test('depois de fechar a tela, desenhar nao escreve mais nada', () => {
  const b = bancada()
  const tela = openScreen(b.term)
  tela.draw(conteudo(['  a']))
  tela.close()
  b.zerar()
  tela.draw(conteudo(['  b']))
  expect(b.escrito()).toBe('')
})
