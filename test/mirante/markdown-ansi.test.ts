import { test, expect } from '../apoio/runner.ts'
import { markdownParaAnsi } from '../../motor/mirante/render/markdown.ts'
import { stripAnsi, visibleLen } from '../../motor/mirante/tui/layout.ts'

function semCor(texto: string): string[] {
  return markdownParaAnsi(texto, { color: false })
}

function comCor(texto: string): string[] {
  return markdownParaAnsi(texto, { color: true })
}

test('sem cor, o markdown vira texto limpo — nada de ** e # na tela', () => {
  const linhas = semCor('# Titulo\n\ntexto **forte** e *leve* com `codigo`\n\n- item um\n- item dois')
  const tudo = linhas.join('\n')
  expect(tudo).not.toContain('**')
  expect(tudo).not.toContain('#')
  expect(tudo).not.toContain('`')
  expect(tudo).toContain('Titulo')
  expect(tudo).toContain('forte')
  expect(tudo).toContain('• item um')
  expect(tudo).toContain('• item dois')
})

test('com cor, negrito e cabecalho ganham ANSI mas a largura visivel nao muda', () => {
  const [cabecalho] = comCor('## Resumo do projeto')
  expect(cabecalho).toContain('\x1b[1m')
  expect(stripAnsi(cabecalho ?? '')).toBe('Resumo do projeto')
  expect(visibleLen(cabecalho ?? '')).toBe('Resumo do projeto'.length)
})

test('codigo entre cercas sai literal, sem interpretar markdown de dentro', () => {
  const linhas = semCor('antes\n```ts\nconst x = **nao vira negrito**\n```\ndepois')
  const tudo = linhas.join('\n')
  expect(tudo).toContain('const x = **nao vira negrito**')
  expect(tudo).toContain('antes')
  expect(tudo).toContain('depois')
  expect(tudo).not.toContain('```')
})

test('cerca aberta e fechada no fim, para nao vazar o resto da resposta', () => {
  const linhas = semCor('```\nsem fechar')
  expect(linhas.filter(l => l.includes('──')).length).toBe(2)
})

test('citacao, regua, tarefa e lista numerada tem marca propria', () => {
  expect(semCor('> pensa bem').join('')).toContain('│ pensa bem')
  expect(semCor('---').join('')).toContain('─')
  expect(semCor('- [x] feito').join('')).toContain('✓ feito')
  expect(semCor('- [ ] falta').join('')).toContain('○ falta')
  expect(semCor('1. primeiro').join('')).toContain('1. primeiro')
})

test('link markdown mostra o texto e a url, sem os colchetes', () => {
  const linha = semCor('veja o [painel](https://exemplo.com/p) hoje').join('')
  expect(linha).toBe('veja o painel https://exemplo.com/p hoje')
})

test('riscado e italico sublinhado nao comem o texto vizinho', () => {
  expect(stripAnsi(comCor('~~caiu~~ e _subiu_').join(''))).toBe('caiu e subiu')
  expect(semCor('a_b_c vale como esta').join('')).toBe('a_b_c vale como esta')
})

test('separador de tabela fica apagado mas a tabela segue alinhada', () => {
  const linhas = comCor('| a | b |\n| --- | --- |\n| 1 | 2 |')
  expect(linhas.length).toBe(3)
  expect(linhas[1]).toContain('\x1b[2m')
  expect(stripAnsi(linhas[0] ?? '').length).toBe(stripAnsi(linhas[2] ?? '').length)
})

test('linha em branco continua em branco, para o texto respirar', () => {
  expect(semCor('um\n\ndois')).toEqual(['um', '', 'dois'])
})
