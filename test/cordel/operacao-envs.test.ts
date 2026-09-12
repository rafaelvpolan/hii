// Deriva de doc medida no raio-x: 68 de 97 envs HICODE_* fora do OPERACAO.md —
// incluindo knobs de custo e timeout — e uma env documentada que nenhuma linha
// lia. O apendice gerado (scripts/varrer-envs.mjs) fecha a porta nas duas
// direcoes: env nova no codigo sem regenerar o doc reprova aqui.
import { test, expect, lerArquivo } from '../apoio/runner.ts'
// hicode:allow-any — o gerador e .mjs; a fronteira de tipos e checada aqui.
import { gerarTabela, lerContrato, reescreverApendice, varrerEnvs } from '../../scripts/varrer-envs.mjs'

test('TODA variavel HICODE_* lida pelo codigo consta em OPERACAO.md', async () => {
  const doc = await lerArquivo('OPERACAO.md')
  const envs = [...(varrerEnvs() as Map<string, Set<string>>).keys()]
  expect(envs.length, 'varredura vazia tornaria este teste incapaz de falhar').toBeGreaterThan(80)
  const fora = envs.filter(nome => !doc.includes(nome))
  expect(fora, 'env nova sem doc: rode `node scripts/varrer-envs.mjs` para regravar o apendice').toEqual([])
})

test('o apendice em OPERACAO.md e IDENTICO ao que o gerador produz hoje — regenerar nao muda um byte', async () => {
  const doc = await lerArquivo('OPERACAO.md')
  const regravado = reescreverApendice(doc, gerarTabela()) as string
  expect(regravado === doc, 'OPERACAO.md derivou do codigo: rode `bun scripts/varrer-envs.mjs` para regravar o apendice').toBe(true)
})

test('a guarda de deriva MORDE: um apendice com uma linha a menos reprova, e regenerar o repoe', async () => {
  const doc = await lerArquivo('OPERACAO.md')
  const tabela = gerarTabela() as string
  const mutilado = reescreverApendice(doc, tabela.split('\n').slice(0, -1).join('\n')) as string
  expect(mutilado === doc, 'tirar uma linha da tabela tem de mudar o documento').toBe(false)
  expect((reescreverApendice(mutilado, tabela) as string) === doc, 'regenerar sobre o mutilado tem de devolver o original').toBe(true)
})

test('a tabela nasce do codigo real: contrato.ts (lado e partilha) e o literal padrao de process.env', () => {
  const contrato = lerContrato() as Map<string, { lado: string; compartilhada: boolean }>
  expect(contrato.size, 'contrato.ts mudou de forma e a leitura textual ficou vazia').toBeGreaterThan(15)
  expect(contrato.get('HICODE_CARDS_DIR')).toEqual({ lado: 'ambos', compartilhada: true })
  const tabela = gerarTabela() as string
  expect(tabela).toContain('| `HICODE_CARDS_DIR` | — | ambos, compartilhada entre clones |')
  expect(tabela).toContain("| `HICODE_PIPELINE` | `'manual'` | — |")
})
