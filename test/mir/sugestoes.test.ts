import { test, expect } from 'bun:test'
import { renderSugestoes, prefixoComum, AJUDA_DO_COMANDO } from '../../motor/mir/render/sugestoes.ts'
import { renderFrame, visibleLen, stripAnsi } from '../../motor/mir/tui/layout.ts'

test('cada comando vem com a descricao ao lado', () => {
  const t = renderSugestoes(['/rm', '/repo'], { width: 78 }).join('\n')
  expect(t).toContain('/rm')
  expect(t).toContain(AJUDA_DO_COMANDO['/rm'] ?? '')
  expect(t).toContain('/repo')
  expect(t).toContain(AJUDA_DO_COMANDO['/repo'] ?? '')
})

test('todos os comandos do catalogo tem descricao', async () => {
  const { COMMANDS } = await import('../../motor/mir/sessao.ts')
  for (const c of COMMANDS) expect(AJUDA_DO_COMANDO[c], c).toBeTruthy()
})

test('nenhuma descricao sobra para comando que nao existe mais', async () => {
  const { COMMANDS } = await import('../../motor/mir/sessao.ts')
  expect(Object.keys(AJUDA_DO_COMANDO).sort()).toEqual([...COMMANDS].sort())
})

test('descricoes alinham numa coluna so', () => {
  const linhas = renderSugestoes(['/rm', '/new-session'], { width: 78 })
  const col = linhas.map(l => l.indexOf(AJUDA_DO_COMANDO['/rm'] ?? 'x'))
  const outra = linhas.map(l => l.indexOf(AJUDA_DO_COMANDO['/new-session'] ?? 'y'))
  expect(Math.max(...col, ...outra)).toBeGreaterThan(0)
  expect(visibleLen(linhas[0] ?? '')).toBeLessThanOrEqual(78)
})

test('a opcao selecionada fica destacada', () => {
  const linhas = renderSugestoes(['/rm', '/repo'], { color: true, selecionado: 1 })
  expect(linhas[1]).toContain('\x1b[7m')
  expect(linhas[0]).not.toContain('\x1b[7m')
})

test('sem selecao, nenhuma fica destacada', () => {
  const linhas = renderSugestoes(['/rm', '/repo'], { color: true })
  expect(linhas.join('')).not.toContain('\x1b[7m')
})

test('mostra no maximo 6 e conta o resto ABAIXO quando a selecao esta no topo', () => {
  const muitos = Array.from({ length: 10 }, (_, i) => `/cmd${i}`)
  const linhas = renderSugestoes(muitos, { width: 78 })
  expect(linhas.length).toBe(7)
  expect(linhas[6]).toContain('4 abaixo')
})

// `slice(0, 6)` fixo fazia o "e mais N" ser beco sem saida: apertar ↓ movia a
// selecao para a setima opcao e a tela continuava nas seis primeiras.
test('a janela SEGUE a selecao — a setima opcao e alcancavel', () => {
  const muitos = Array.from({ length: 10 }, (_, i) => `/cmd${i}`)
  const noFim = renderSugestoes(muitos, { width: 78, selecionado: 9 }).join('\n')
  expect(noFim, 'a ultima opcao tem de aparecer na tela').toContain('/cmd9')
  expect(noFim, 'e a contagem passa a ser do que ficou ACIMA').toContain('4 acima')
  expect(noFim).not.toContain('abaixo')
})

test('a opcao selecionada esta SEMPRE na tela, em qualquer posicao da lista', () => {
  const muitos = Array.from({ length: 40 }, (_, i) => `/cmd${String(i).padStart(2, '0')}`)
  for (let sel = 0; sel < muitos.length; sel++) {
    const texto = renderSugestoes(muitos, { width: 78, selecionado: sel }).join('\n')
    expect(texto, `selecionado ${sel} fora da tela`).toContain(muitos[sel] ?? '')
  }
})

test('a janela respeita o teto de linhas do terminal — senao o quadro corta e a navegacao morre', async () => {
  const { cabemQuantasSugestoes } = await import('../../motor/mir/render/sugestoes.ts')
  expect(cabemQuantasSugestoes(60), 'terminal alto: o teto padrao').toBe(6)
  expect(cabemQuantasSugestoes(20)).toBe(6)
  expect(cabemQuantasSugestoes(18)).toBe(4)
  expect(cabemQuantasSugestoes(8), 'terminal baixo: menos opcoes, mas navegaveis').toBe(1)
  const muitos = Array.from({ length: 20 }, (_, i) => `/cmd${i}`)
  const apertado = renderSugestoes(muitos, { width: 78, selecionado: 19, maxLinhas: 2 })
  expect(apertado.filter(l => l.includes('/cmd')).length).toBe(2)
  expect(apertado.join('\n'), 'a selecao continua visivel no aperto').toContain('/cmd19')
})

test('lista vazia nao ocupa espaco', () => {
  expect(renderSugestoes([])).toEqual([])
})

test('cabe na largura, mesmo em terminal estreito', () => {
  for (const width of [30, 50, 78]) {
    for (const l of renderSugestoes(['/new-session', '/rm'], { width })) {
      expect(visibleLen(l)).toBeLessThanOrEqual(width)
    }
  }
})

test('sem cor nao emite escape ANSI', () => {
  expect(renderSugestoes(['/rm'], { color: false }).join('')).not.toContain('\x1b[')
})

test('prefixo comum das opcoes', () => {
  expect(prefixoComum(['/repo', '/reject'])).toBe('/re')
  expect(prefixoComum(['/rm'])).toBe('/rm')
  expect(prefixoComum(['/rm', '/board'])).toBe('/')
  expect(prefixoComum([])).toBe('')
})

test('sugestoes ficam ACIMA da linha de digitacao', () => {
  const f = renderFrame({
    rows: 14, cols: 60, header: 'hii', corpo: ['x'], input: '/r', cursor: 2,
    dica: '', prompt: '› ', rodape: ['ia claude'], sugestoes: ['  /rm  apaga', '  /repo  troca'],
  })
  const texto = f.lines.map(stripAnsi)
  const iSug = texto.findIndex(l => l.includes('/rm  apaga'))
  const iInput = texto.findIndex(l => l.includes('› /r'))
  const iRodape = texto.findIndex(l => l.includes('ia claude'))
  expect(iSug).toBeLessThan(iInput)
  expect(iInput).toBeLessThan(iRodape)
})

test('sugestoes nao desalinham o quadro nem perdem o cursor', () => {
  const f = renderFrame({
    rows: 14, cols: 60, header: 'hii', corpo: ['x'], input: '/re', cursor: 3,
    dica: '', prompt: '› ', rodape: [], sugestoes: ['  /repo', '  /reject'],
  })
  expect(new Set(f.lines.map(l => visibleLen(l))).size).toBe(1)
  expect(f.cursorCol).toBe(3 + 2 + 3)
  expect(stripAnsi(f.lines[f.cursorRow - 1] ?? '')).toContain('/re')
})

test('sem grupoDe, a lista sai identica a antes (nenhum cabecalho)', () => {
  const antes = renderSugestoes(['/rm', '/repo'], { width: 78 })
  const depois = renderSugestoes(['/rm', '/repo'], { width: 78, grupoDe: undefined })
  expect(depois).toEqual(antes)
})

test('com comandos da ia misturados, aparecem duas secoes com cabecalho', () => {
  const grupoDe = (opcao: string) => (opcao === '/review' ? { titulo: 'codex', cor: { r: 16, g: 163, b: 127 } } : null)
  const linhas = renderSugestoes(['/repo', '/review'], { width: 78, grupoDe }).map(stripAnsi)
  expect(linhas[0]).toBe('  hii')
  expect(linhas[1]).toContain('/repo')
  expect(linhas[2]).toBe('  codex')
  expect(linhas[3]).toContain('/review')
})

test('sem nenhum comando de ia na lista mostrada, nao aparece cabecalho mesmo com grupoDe', () => {
  const grupoDe = () => null
  const linhas = renderSugestoes(['/rm', '/repo'], { width: 78, grupoDe })
  expect(linhas.some(l => l.trim() === 'hii')).toBe(false)
})

test('a descricao da ia vem de descricaoDe, sem contaminar AJUDA_DO_COMANDO', () => {
  const grupoDe = () => ({ titulo: 'codex', cor: { r: 16, g: 163, b: 127 } })
  const descricaoDe = (opcao: string) => (opcao === '/review' ? 'revisa o diff' : '')
  const linhas = renderSugestoes(['/review'], { width: 78, grupoDe, descricaoDe })
  expect(linhas.join('\n')).toContain('revisa o diff')
  expect(AJUDA_DO_COMANDO['/review']).toBeUndefined()
})

test('REGRESSAO: descricaoDe que nao conhece o comando do hii cai no AJUDA_DO_COMANDO padrao', () => {
  const descricaoDe = (opcao: string) => (opcao === '/review' ? 'revisa o diff' : undefined)
  const linhas = renderSugestoes(['/rm', '/review'], { width: 78, descricaoDe }).join('\n')
  expect(linhas).toContain(AJUDA_DO_COMANDO['/rm'] ?? '')
  expect(linhas).toContain('revisa o diff')
})

test('o item da ia sai na cor de marca informada, nao na cor padrao do hii', () => {
  const grupoDe = () => ({ titulo: 'codex', cor: { r: 16, g: 163, b: 127 } })
  const linhas = renderSugestoes(['/review'], { color: true, width: 78, grupoDe, profundidade: 'truecolor' })
  const linhaDoItem = linhas.find(l => l.includes('/review')) ?? ''
  expect(linhaDoItem).toContain('\x1b[38;2;16;163;127m')
})

test('comando digitado pode sair colorido sem mover o cursor', () => {
  const semCor = renderFrame({
    rows: 12, cols: 50, header: 'h', corpo: [], input: '/rm 23', cursor: 6,
    dica: '', prompt: '› ', rodape: [],
  })
  const comCor = renderFrame({
    rows: 12, cols: 50, header: 'h', corpo: [], input: '/rm 23', cursor: 6,
    dica: '', prompt: '› ', rodape: [], corInput: (l) => `\x1b[36m${l}\x1b[0m`,
  })
  expect(comCor.cursorCol).toBe(semCor.cursorCol)
  expect(comCor.cursorRow).toBe(semCor.cursorRow)
  expect(stripAnsi(comCor.lines[comCor.cursorRow - 1] ?? '')).toBe(stripAnsi(semCor.lines[semCor.cursorRow - 1] ?? ''))
})

// app.ts monta `sugestoes: [...acima, ...sugestoes]`, e o corte era pelo FIM: o
// painel de aprovacao sobrevivia e as SUGESTOES morriam — inclusive a opcao
// selecionada, quando a selecao estava no fim da lista. Quem tem a lista de
// completacao aberta precisa ver a completacao.
test('REGRESSAO: quando o espaco aperta, quem cede e o painel de cima, nao a sugestao', async () => {
  const { renderFrame } = await import('../../motor/mir/tui/layout.ts')
  const painel = ['  APROVAR?', '  [1] sim', '  [2] nao', '  [3] comentar', '  ---']
  const opcoes = ['/ajuda', '/config', '>>> /verificar <<<']
  const f = renderFrame({
    header: 'h', corpo: ['linha'], rodape: [], input: '/', cursor: 1,
    cols: 60, rows: 9, sugestoes: [...painel, ...opcoes], prompt: '> ', dica: '',
  })
  const tela = f.lines.join('\n')
  expect(tela, 'a opcao selecionada tem de sobreviver ao corte').toContain('>>> /verificar <<<')
  expect(tela.includes('APROVAR?'), 'o topo do painel e o que cede').toBe(false)
})

test('sem aperto, painel e sugestoes aparecem juntos', async () => {
  const { renderFrame } = await import('../../motor/mir/tui/layout.ts')
  const f = renderFrame({
    header: 'h', corpo: ['linha'], rodape: [], input: '/', cursor: 1,
    cols: 60, rows: 40, sugestoes: ['  APROVAR?', '/ajuda'], prompt: '> ', dica: '',
  })
  const tela = f.lines.join('\n')
  expect(tela).toContain('APROVAR?')
  expect(tela).toContain('/ajuda')
})

// `slice(-n || length)` acertava por ACIDENTE: com n=0, `-0` e falsy e o fallback
// `slice(length)` da vazio por coincidencia. Estes tres pontos travam o
// comportamento nas bordas para a proxima reescrita nao passar em silencio.
test('as bordas do corte de sugestao: nenhuma, algumas, todas', async () => {
  const { orcamentoDoCorpo } = await import('../../motor/mir/tui/layout.ts')
  const base = { temLegenda: false, temDica: false, linhasDeEntrada: 1, linhasDeRodape: 0 }
  const s = ['a', 'b', 'c']
  const corta = (n: number): string[] => s.slice(Math.max(0, s.length - n))
  expect(corta(0), 'orcamento zero mostra NADA, nao tudo').toEqual([])
  expect(corta(2), 'mantem o FIM, que e onde estao as sugestoes').toEqual(['b', 'c'])
  expect(corta(9), 'orcamento maior que a lista nao duplica nem estoura').toEqual(['a', 'b', 'c'])
  expect(orcamentoDoCorpo({ ...base, rows: 5, linhasAcima: 3 }).sugVisiveis).toBeGreaterThanOrEqual(0)
})
