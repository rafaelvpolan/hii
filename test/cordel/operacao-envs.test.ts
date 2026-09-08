// Deriva de doc medida no raio-x: 68 de 97 envs HICODE_* fora do OPERACAO.md —
// incluindo knobs de custo e timeout — e uma env documentada que nenhuma linha
// lia. O apendice gerado (scripts/varrer-envs.mjs) fecha a porta nas duas
// direcoes: env nova no codigo sem regenerar o doc reprova aqui.
import { test, expect, lerArquivo } from '../apoio/runner.ts'
// hicode:allow-any — o gerador e .mjs; a fronteira de tipos e checada aqui.
import { varrerEnvs } from '../../scripts/varrer-envs.mjs'

test('TODA variavel HICODE_* lida pelo codigo consta em OPERACAO.md', async () => {
  const doc = await lerArquivo('OPERACAO.md')
  const envs = [...(varrerEnvs() as Map<string, Set<string>>).keys()]
  expect(envs.length, 'varredura vazia tornaria este teste incapaz de falhar').toBeGreaterThan(80)
  const fora = envs.filter(nome => !doc.includes(nome))
  expect(fora, 'env nova sem doc: rode `node scripts/varrer-envs.mjs` para regravar o apendice').toEqual([])
})
