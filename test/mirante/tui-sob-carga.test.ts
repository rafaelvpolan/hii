import { test, expect } from '../apoio/runner.ts'
import { renderFrame, visibleLen, quebrarEmLargura, truncVisible } from '../../motor/mirante/tui/layout.ts'
import { frameToAnsi, pinturaDiferencial } from '../../motor/mirante/tui/screen.ts'
import type { FrameInput } from '../../motor/mirante/tui/layout.ts'

// MIR — a guarda contra TRAVAMENTO. O teto de tempo do arquivo ao lado mede o
// caso normal; aqui o estado e hostil de proposito: log gigante, linha unica
// absurdamente longa, terminal de uma coluna, milhares de cards.
//
// A propriedade que importa nao e "e rapido", e "o custo NAO depende do tamanho
// do estado". Uma TUI que fica 1ms mais lenta a cada card acumulado trava depois
// de uma semana ligada, e o teste que so mede o caso pequeno nunca ve isso.

const TETO_MS = Number(process.env.HICODE_TETO_CARGA_MS) > 0 ? Number(process.env.HICODE_TETO_CARGA_MS) : 50

function ms(fn: () => void): number {
  for (let i = 0; i < 10; i++) fn()
  const tempos: number[] = []
  for (let i = 0; i < 40; i++) {
    const t = performance.now()
    fn()
    tempos.push(performance.now() - t)
  }
  tempos.sort((a, b) => a - b)
  return tempos[Math.floor(tempos.length / 2)] ?? 0
}

const BASE: Omit<FrameInput, 'rows' | 'cols' | 'corpo'> = {
  header: 'hii · org/app', input: 'entrada', cursor: 3, dica: 'dica', prompt: '› ', rodape: ['r'],
}

const LOG_ENORME = Array.from({ length: 200_000 }, (_, i) => `  #${i} linha de log`)
const LINHA_MONSTRO = ['x'.repeat(500_000)]
const MUITOS_CARDS = Array.from({ length: 20_000 }, (_, i) => `  #${String(i).padStart(5, '0')} 中文 😀 tarefa em execucao`)
const RODAPE_ENORME = Array.from({ length: 5_000 }, (_, i) => `rodape ${i}`)

test('CARGA log de 200 mil linhas pinta sob o teto', () => {
  const t = ms(() => { renderFrame({ ...BASE, rows: 40, cols: 120, corpo: LOG_ENORME }) })
  expect(t, `levou ${t.toFixed(3)}ms com 200k linhas`).toBeLessThan(TETO_MS)
})

test('CARGA uma unica linha de meio milhao de caracteres pinta sob o teto', () => {
  const t = ms(() => { renderFrame({ ...BASE, rows: 40, cols: 120, corpo: LINHA_MONSTRO }) })
  expect(t, `levou ${t.toFixed(3)}ms com linha de 500k`).toBeLessThan(TETO_MS)
})

test('CARGA 20 mil cards com CJK e emoji pintam sob o teto', () => {
  const t = ms(() => { renderFrame({ ...BASE, rows: 40, cols: 120, corpo: MUITOS_CARDS }) })
  expect(t, `levou ${t.toFixed(3)}ms com 20k cards`).toBeLessThan(TETO_MS)
})

test('CARGA rodape de 5 mil linhas nao empurra o corpo para fora nem estoura o tempo', () => {
  const t = ms(() => { renderFrame({ ...BASE, rows: 40, cols: 120, corpo: LOG_ENORME, rodape: RODAPE_ENORME }) })
  expect(t, `levou ${t.toFixed(3)}ms com rodape de 5k`).toBeLessThan(TETO_MS)
  const f = renderFrame({ ...BASE, rows: 40, cols: 120, corpo: LOG_ENORME, rodape: RODAPE_ENORME })
  expect(f.lines.length, 'rodape gigante nao pode produzir quadro maior que a tela').toBeLessThanOrEqual(42)
})

test('CARGA terminal de UMA coluna com estado gigante nao trava nem estoura', () => {
  const t = ms(() => { renderFrame({ ...BASE, rows: 24, cols: 1, corpo: LOG_ENORME }) })
  expect(t, `levou ${t.toFixed(3)}ms em 1 coluna`).toBeLessThan(TETO_MS)
})

test('CARGA o TAMANHO DA SAIDA nao cresce com o tamanho do estado', () => {
  const pequeno = renderFrame({ ...BASE, rows: 40, cols: 120, corpo: LOG_ENORME.slice(0, 100) })
  const enorme = renderFrame({ ...BASE, rows: 40, cols: 120, corpo: LOG_ENORME })
  expect(enorme.lines.length).toBe(pequeno.lines.length)
  // A saida ANSI de um quadro e funcao da tela, nao do log por tras dela.
  expect(Math.abs(frameToAnsi(enorme).length - frameToAnsi(pequeno).length)).toBeLessThan(2_000)
})

test('CARGA a linha monstro e CORTADA na largura, nao levada inteira para a tela', () => {
  const f = renderFrame({ ...BASE, rows: 24, cols: 80, corpo: LINHA_MONSTRO })
  for (const l of f.lines) expect(visibleLen(l)).toBe(80)
  expect(frameToAnsi(f).length, 'a saida carregou a linha inteira em vez do recorte').toBeLessThan(50_000)
})

test('CARGA pintura diferencial com estado gigante continua barata', () => {
  const a = renderFrame({ ...BASE, rows: 40, cols: 120, corpo: LOG_ENORME })
  const b = renderFrame({ ...BASE, rows: 40, cols: 120, corpo: LOG_ENORME.slice(0, 199_999) })
  const t = ms(() => { pinturaDiferencial(b, a.lines) })
  expect(t, `levou ${t.toFixed(4)}ms`).toBeLessThan(TETO_MS)
})

test('CARGA quebrarEmLargura de texto enorme termina sob o teto', () => {
  const texto = 'palavra '.repeat(60_000)
  const t = ms(() => { quebrarEmLargura(texto, 80) })
  expect(t, `levou ${t.toFixed(3)}ms`).toBeLessThan(TETO_MS * 10)
})

// truncVisible e O(tamanho do texto), nao O(colunas pedidas): larguraDeTexto,
// stripAnsi e o split percorrem a string inteira antes de cortar 80 colunas.
// Medido: ~189x mais caro num texto 500x maior.
//
// O custo de cortar 80 colunas passou a depender das 80 COLUNAS, e nao do tamanho da
// entrada. Antes dependia da entrada: `truncVisible` fazia tres travessias completas
// (visibleLen para decidir se cortava, split para as partes ANSI, grafemasDe para os
// grafemas de cada parte) antes de olhar o teto. Medido na entrada 500x maior: 140x
// o tempo em ASCII e 417x em Unicode — 34ms por chamada, dentro do desenho da TUI.
//
// O teste que existia aqui media a razao por COLUNAS PEDIDAS e passava com folga —
// justamente PORQUE tudo era O(n) e o numero de colunas nao mudava nada. Ele
// certificava o defeito. A razao que separa as duas coisas e a do TAMANHO DA
// ENTRADA, com as colunas fixas: e ela que fica abaixo.
test('CARGA truncVisible de meio milhao de caracteres termina em tempo de quadro', () => {
  const t = ms(() => { truncVisible('x'.repeat(500_000), 80) })
  expect(t, `levou ${t.toFixed(3)}ms para cortar 80 colunas de 500k`).toBeLessThan(TETO_MS)
})

function razaoPorTamanho(curto: string, longo: string): number {
  // Aquece: a primeira chamada paga JIT e a construcao do Intl.Segmenter.
  for (let i = 0; i < 200; i++) { truncVisible(curto, 80); truncVisible(longo, 80) }
  const a = ms(() => { for (let i = 0; i < 300; i++) truncVisible(curto, 80) })
  const b = ms(() => { for (let i = 0; i < 300; i++) truncVisible(longo, 80) })
  return b / Math.max(a, 0.0001)
}

test('REGRESSAO cortar 80 colunas custa o mesmo numa entrada 500x maior', () => {
  const r = razaoPorTamanho('x'.repeat(200), 'x'.repeat(100_000))
  expect(r, `entrada 500x maior custou ${r.toFixed(1)}x (era 140x antes da reescrita)`).toBeLessThan(5)
})

// Unicode era o caso pior (417x): o segmentador tem custo de PREPARO proporcional a
// |s|, entao "iterar preguicosamente" nao bastava — a string entregue a ele tem de
// ser pequena. Sem esta linha, uma reescrita que volte a segmentar a string toda
// passa no teste de ASCII e reintroduz o travamento so em texto acentuado.
test('REGRESSAO e o mesmo vale para texto Unicode, que era o caso pior', () => {
  const r = razaoPorTamanho('á😀'.repeat(100), 'á😀'.repeat(50_000))
  expect(r, `entrada 500x maior custou ${r.toFixed(1)}x (era 417x antes da reescrita)`).toBeLessThan(5)
})

test('CARGA estado gigante em TODO tamanho de terminal, sem excecao e sem quadro torto', () => {
  const quebras: string[] = []
  for (const [rows, cols] of [[1, 1], [1, 80], [2, 2], [3, 200], [24, 80], [60, 300], [200, 500]] as const) {
    try {
      const f = renderFrame({ ...BASE, rows, cols, corpo: MUITOS_CARDS, rodape: RODAPE_ENORME, legenda: 'entrada', input: 'a'.repeat(1000) })
      const larguras = [...new Set(f.lines.map(l => visibleLen(l)))]
      if (larguras.length > 1) quebras.push(`${rows}x${cols}: larguras ${JSON.stringify(larguras)}`)
    } catch (e) {
      quebras.push(`${rows}x${cols}: ${String((e as Error).message).slice(0, 80)}`)
    }
  }
  expect(quebras).toEqual([])
})
