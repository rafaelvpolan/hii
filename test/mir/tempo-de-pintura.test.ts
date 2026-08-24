import { test, expect } from 'bun:test'
import { renderFrame } from '../../motor/mir/tui/layout.ts'
import { frameToAnsi, pinturaDiferencial } from '../../motor/mir/tui/screen.ts'
import type { FrameInput } from '../../motor/mir/tui/layout.ts'

// MIR — o teto de tempo do quadro, medido. "Parece rapido" e o mesmo teatro de
// qualidade que o motor recusa num gate: sem numero nao ha reprovacao possivel.
//
// Duas familias de asserção, e as duas precisam existir:
//
// ABSOLUTA. Teto em milissegundos, com folga larga — os numeros medidos nesta
// maquina ficam entre 0,04ms e 0,5ms, e os tetos abaixo sao dezenas de vezes
// maiores. A folga e deliberada: runner de CI compartilhado e ordens de grandeza
// mais lento e irregular que uma maquina de trabalho, e teste de tempo que pisca
// e pior que teste de tempo nenhum, porque ensina a ignorar vermelho.
//
// ALGORITMICA. O custo do quadro nao pode crescer com o TAMANHO DO LOG, so com a
// area visivel. Esta e a asserção que de fato protege contra travamento, e ela
// nao depende da velocidade da maquina — e por isso a que aperta de verdade.

const AMOSTRAS = 200
const AQUECIMENTO = 50

function tetoDeEnv(nome: string, padrao: number): number {
  const v = Number(process.env[nome])
  return Number.isFinite(v) && v > 0 ? v : padrao
}

const TETO_QUADRO_MS = tetoDeEnv('HICODE_TETO_QUADRO_MS', 8)
const TETO_QUADRO_CJK_MS = tetoDeEnv('HICODE_TETO_QUADRO_CJK_MS', 30)
const TETO_PINTURA_MS = tetoDeEnv('HICODE_TETO_PINTURA_MS', 6)

// Mediana, nao maxima: uma pausa de GC ou o escalonador do CI tirando a CPU
// produz um outlier que nao diz nada sobre o custo do algoritmo.
function medianaDeMs(fn: () => void, amostras = AMOSTRAS): number {
  for (let i = 0; i < AQUECIMENTO; i++) fn()
  const tempos: number[] = []
  for (let i = 0; i < amostras; i++) {
    const t = performance.now()
    fn()
    tempos.push(performance.now() - t)
  }
  tempos.sort((a, b) => a - b)
  return tempos[Math.floor(tempos.length / 2)] ?? 0
}

const BASE: Omit<FrameInput, 'rows' | 'cols' | 'corpo'> = {
  header: 'hii · org/app · daemon online',
  input: 'uma linha de entrada com tamanho realista',
  cursor: 10, dica: '/help para ajuda', prompt: '› ',
  rodape: ['#020 executando', '#021 na fila'],
}

// Corpos PRE-CONSTRUIDOS. Construir o array dentro do trecho cronometrado
// mediria a criacao do array em vez da pintura — foi o primeiro erro ao calibrar
// estes numeros, e ele fazia o custo parecer crescer com o tamanho do log.
const linhas = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `  #${String(i).padStart(4, '0')} linha de log com conteudo de tamanho medio`)

const CORPO_CURTO = linhas(200)
const CORPO_LONGO = linhas(100_000)
const CORPO_CJK = Array.from({ length: 200 }, (_, i) => `  中文 😀 ${i} 👨‍👩‍👧 linha com largura dupla`)

test('TETO um quadro de terminal grande fica sob o orcamento', () => {
  const ms = medianaDeMs(() => { renderFrame({ ...BASE, rows: 50, cols: 200, corpo: CORPO_CURTO }) })
  expect(ms, `quadro 50x200 levou ${ms.toFixed(3)}ms, teto ${TETO_QUADRO_MS}ms`).toBeLessThan(TETO_QUADRO_MS)
})

test('TETO quadro de CJK e emoji fica sob o orcamento (segmentador custa mais)', () => {
  const ms = medianaDeMs(() => { renderFrame({ ...BASE, rows: 50, cols: 200, corpo: CORPO_CJK }) })
  expect(ms, `quadro CJK levou ${ms.toFixed(3)}ms, teto ${TETO_QUADRO_CJK_MS}ms`).toBeLessThan(TETO_QUADRO_CJK_MS)
})

test('TETO converter o quadro em ANSI fica sob o orcamento', () => {
  const f = renderFrame({ ...BASE, rows: 50, cols: 200, corpo: CORPO_CURTO })
  const ms = medianaDeMs(() => { frameToAnsi(f) })
  expect(ms, `frameToAnsi levou ${ms.toFixed(3)}ms, teto ${TETO_PINTURA_MS}ms`).toBeLessThan(TETO_PINTURA_MS)
})

test('TETO a pintura diferencial fica sob o orcamento, inclusive quando tudo mudou', () => {
  const a = renderFrame({ ...BASE, rows: 50, cols: 200, corpo: CORPO_CURTO })
  const b = renderFrame({ ...BASE, rows: 50, cols: 200, corpo: linhas(400) })
  const igual = medianaDeMs(() => { pinturaDiferencial(a, a.lines) })
  const tudoDiferente = medianaDeMs(() => { pinturaDiferencial(b, a.lines) })
  expect(igual, `quadro identico levou ${igual.toFixed(4)}ms`).toBeLessThan(TETO_PINTURA_MS)
  expect(tudoDiferente, `quadro todo diferente levou ${tudoDiferente.toFixed(4)}ms`).toBeLessThan(TETO_PINTURA_MS)
})

test('TETO quadro identico ao anterior nao reescreve nada — pintura vazia e a mais barata', () => {
  const f = renderFrame({ ...BASE, rows: 50, cols: 200, corpo: CORPO_CURTO })
  const pintura = pinturaDiferencial(f, f.lines)
  // So o reposicionamento do cursor. Se isto crescer, a pintura voltou a
  // reescrever linha igual, e o terminal pisca de novo.
  expect(pintura).toBe(`\x1b[${f.cursorRow};${f.cursorCol}H`)
})

test('ALGORITMICO o custo do quadro nao cresce com o TAMANHO DO LOG, so com a area visivel', () => {
  const curto = medianaDeMs(() => { renderFrame({ ...BASE, rows: 50, cols: 200, corpo: CORPO_CURTO }) })
  const longo = medianaDeMs(() => { renderFrame({ ...BASE, rows: 50, cols: 200, corpo: CORPO_LONGO }) })
  // 500x mais linhas de log. Se renderFrame passasse a varrer o corpo inteiro —
  // um map, um filter, um join antes de recortar —, esta razao explodiria e a
  // TUI travaria com log longo. O fator 4 e folga para ruido de medicao, nao
  // para regressao algoritmica: crescimento linear daria ~500.
  const razao = longo / Math.max(curto, 0.0001)
  expect(razao, `corpo 500x maior custou ${razao.toFixed(1)}x (${curto.toFixed(4)}ms -> ${longo.toFixed(4)}ms) — o quadro voltou a varrer o log inteiro`).toBeLessThan(4)
})

test('ALGORITMICO dobrar a area visivel nao mais que quadruplica o custo', () => {
  const pequeno = medianaDeMs(() => { renderFrame({ ...BASE, rows: 25, cols: 100, corpo: CORPO_CURTO }) })
  const grande = medianaDeMs(() => { renderFrame({ ...BASE, rows: 50, cols: 200, corpo: CORPO_CURTO }) })
  const razao = grande / Math.max(pequeno, 0.0001)
  expect(razao, `4x a area custou ${razao.toFixed(1)}x — esperado proximo de 4, nunca superlinear`).toBeLessThan(10)
})
