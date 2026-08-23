import { test, expect } from 'bun:test'
import { checklistParaStack, lerChecklist, renderizarChecklist, stacksComChecklist } from '../../motor/agentes/vtb/checklist'

test('o repo tem checklist para as stacks que ele de fato atende', () => {
  expect(stacksComChecklist()).toEqual(['laravel', 'typescript'])
})

test('todo item tem id e texto de checagem — item sem id nao da para citar numa reprovacao', () => {
  for (const stack of stacksComChecklist()) {
    const c = lerChecklist(stack)
    expect(c?.itens.length, `${stack} sem item`).toBeGreaterThan(3)
    for (const i of c?.itens ?? []) {
      expect(i.id).not.toBe('')
      expect(i.checa.length).toBeGreaterThan(20)
    }
    expect(new Set(c?.itens.map(i => i.id)).size, `${stack} tem id repetido`).toBe(c?.itens.length ?? 0)
  }
})

test('a stack do contrato casa com o checklist, e sem match devolve null', () => {
  expect(checklistParaStack('Laravel 12 · PHP 8.4')?.stack).toBe('laravel')
  expect(checklistParaStack('TypeScript · Bun')?.stack).toBe('typescript')
  expect(checklistParaStack('Elixir · Phoenix'), 'sem match o baseline generico segue sozinho').toBeNull()
  expect(checklistParaStack('')).toBeNull()
})

test('o checklist de Laravel cobra o que mais quebra nesse stack', () => {
  const texto = renderizarChecklist(lerChecklist('laravel'))
  expect(texto).toContain('fillable')
  expect(texto).toContain('down()')
  expect(texto, 'cache com tag sem invalidacao no mesmo commit e o erro mais citado').toContain('invalidacao')
})

test('o de TypeScript cobra execFile e bind — os dois achados reais desta base', () => {
  const texto = renderizarChecklist(lerChecklist('typescript'))
  expect(texto).toContain('execFile')
  expect(texto).toContain('hostname')
})

test('renderizar sem checklist devolve vazio, nao cabecalho solto', () => {
  expect(renderizarChecklist(null)).toBe('')
})

test('INVARIANTE so o papel de seguranca recebe o checklist de stack', async () => {
  const fonte = await Bun.file('motor/cic/agente.ts').text()
  expect(fonte).toContain("papel === 'seguranca' ? renderizarChecklist(checklistParaStack(")
})
