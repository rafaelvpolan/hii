// memoArquivo devolvia o VALOR EM CACHE quando o stat falhava: a assinatura de
// erro era '' e casava com um '' anterior — card apagado continuava sendo
// servido do cache como se existisse (raio-x, item 25). Arquivo que sumiu agora
// derruba a entrada e recomputa, e o erro real (se houver) e de quem le.
import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const DIR = mkdtempSync(join(tmpdir(), 'hicode-memo-'))

const { memoArquivo } = await import('../../motor/tomada/eco/memo.ts')

afterAll(() => rmSync(DIR, { recursive: true, force: true }))

test('arquivo apagado NAO e servido do cache — a leitura seguinte recomputa', () => {
  const arquivo = join(DIR, 'a.txt')
  writeFileSync(arquivo, 'um')
  let leituras = 0
  const ler = memoArquivo(() => arquivo, () => ++leituras)
  expect(ler('a')).toBe(1)
  expect(ler('a'), 'com o arquivo intacto, o cache vale').toBe(1)
  unlinkSync(arquivo)
  expect(ler('a'), 'sumiu do disco: recomputa em vez de servir o fantasma').toBe(2)
  expect(ler('a'), 'e continua recomputando enquanto nao volta').toBe(3)
  writeFileSync(arquivo, 'dois')
  expect(ler('a')).toBe(4)
  expect(ler('a'), 'voltou: o cache volta a valer').toBe(4)
})
