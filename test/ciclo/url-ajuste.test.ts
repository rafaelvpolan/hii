import { test, expect } from '../apoio/runner.ts'
import { instrucaoDeAjuste, relatoDoAjuste, subirUrlComAjuste, TENTATIVAS_DE_AJUSTE } from '../../motor/ciclo/reprise/url-ajuste.ts'

function deps(sobeNaTentativa: number) {
  const chamadas = { subir: 0, ajustar: 0 }
  return {
    chamadas,
    deps: {
      subir: async (): Promise<number> => { chamadas.subir += 1; return 4242 },
      responde: async (): Promise<boolean> => chamadas.subir >= sobeNaTentativa,
      ajustar: async (_m: string, n: number): Promise<string> => { chamadas.ajustar += 1; return `ajuste ${n}` },
    },
  }
}

test('url que sobe de primeira nao chama a IA para ajustar nada', async () => {
  const { deps: d, chamadas } = deps(1)
  const t = await subirUrlComAjuste(d)
  expect(t.noAr).toBe(true)
  expect(chamadas.ajustar).toBe(0)
  expect(relatoDoAjuste(t)).toBe('url no ar de primeira')
})

test('url que nao responde e AJUSTADA e retentada — nao vira HALT nem passa batido', async () => {
  const { deps: d, chamadas } = deps(2)
  const t = await subirUrlComAjuste(d)
  expect(chamadas.ajustar).toBe(1)
  expect(t.noAr).toBe(true)
  expect(relatoDoAjuste(t)).toContain('depois de 1 ajuste')
})

test('o ajuste e limitado — nao fica tentando para sempre', async () => {
  const { deps: d, chamadas } = deps(99)
  const t = await subirUrlComAjuste(d)
  expect(t.noAr).toBe(false)
  expect(chamadas.ajustar).toBe(TENTATIVAS_DE_AJUSTE)
  expect(relatoDoAjuste(t)).toContain('precisa de olho humano')
})

test('a instrucao de ajuste manda mexer so no que impede a url, nao no resultado', () => {
  const i = instrucaoDeAjuste(4331, 1)
  expect(i).toContain('4331')
  expect(i).toContain('Nao mude o comportamento entregue pela tarefa')
})
