// avisarFalhaSilenciosa: o catch das tarefas de manutencao do tick (poda de tmp,
// poda de registros, medicao de disco) engolia a falha sem UMA linha — a poda
// parava de rodar e o operador so descobria com o volume cheio. A funcao grita uma
// vez por rotulo+motivo, com a CONSEQUENCIA escrita, no mesmo Set de dedupe do
// aviso de arquivo ilegivel (motor/cordel/alicerce/aviso.ts).
import { test, expect, beforeEach } from '../apoio/runner.ts'

const { avisarFalhaSilenciosa, esquecerAvisosDeArquivo } = await import('../../motor/cordel/alicerce/aviso.ts')

function capturandoStderr(fn: () => void): string[] {
  const linhas: string[] = []
  const original = process.stderr.write
  process.stderr.write = ((s: string | Uint8Array) => { linhas.push(String(s)); return true }) as typeof process.stderr.write
  try {
    fn()
  } finally {
    process.stderr.write = original
  }
  return linhas
}

beforeEach(() => esquecerAvisosDeArquivo())

test('grita UMA vez por rotulo+motivo, com rotulo, motivo e consequencia na linha', () => {
  const linhas = capturandoStderr(() => {
    avisarFalhaSilenciosa('poda de tmp', 'EACCES: permission denied', 'disco do motor enchendo em silencio')
    avisarFalhaSilenciosa('poda de tmp', 'EACCES: permission denied', 'disco do motor enchendo em silencio')
  })
  expect(linhas.length).toBe(1)
  expect(linhas[0]).toContain('poda de tmp FALHOU')
  expect(linhas[0]).toContain('EACCES')
  expect(linhas[0]).toContain('disco do motor enchendo em silencio')
})

test('motivo NOVO no mesmo rotulo volta a gritar — causa diferente nao fica muda', () => {
  const linhas = capturandoStderr(() => {
    avisarFalhaSilenciosa('poda de registros', 'EACCES', 'runs crescendo sem teto')
    avisarFalhaSilenciosa('poda de registros', 'EBUSY', 'runs crescendo sem teto')
  })
  expect(linhas.length).toBe(2)
})
