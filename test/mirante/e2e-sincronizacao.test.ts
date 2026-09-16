import { test, expect } from '../apoio/runner.ts'
import { revelarIndicadores } from './e2e/navegacao.ts'

test('/ia espera resposta completa: status transitorio nao dispensa rolagem depois da ajuda', async () => {
  let quadro = '[ok] codex\n/ia claude'
  let teclas = 0
  let repinturas = 0
  await revelarIndicadores({
    texto: async () => quadro,
    esperarTexto: async texto => {
      if (texto === '/ia padrao gate') quadro = '/ia claude\n/ia padrao gate'
    },
    tecla: async () => { teclas++ },
    esperarMudanca: async anterior => {
      expect(anterior).toContain('/ia padrao gate')
      repinturas++
      quadro = '[ok] codex\n[cota] claude'
    },
  })
  expect(teclas).toBe(1)
  expect(repinturas).toBe(1)
  expect(quadro).toContain('[ok]')
})

test('/ia nao rola se indicadores persistem na resposta completa', async () => {
  let teclas = 0
  const esperas: string[] = []
  await revelarIndicadores({
    texto: async () => '[ok] codex\n/ia padrao gate',
    esperarTexto: async texto => { esperas.push(texto) },
    tecla: async () => { teclas++ },
    esperarMudanca: async () => {},
  })
  expect(teclas).toBe(0)
  expect(esperas).toEqual(['/ia padrao gate'])
})
