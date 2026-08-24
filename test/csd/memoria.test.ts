import { test, expect, afterAll } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-memoria-'))
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const { readProjectMemory, appendProjectMemory, TETO_DA_MEMORIA } = await import('../../motor/csd/memoria.ts')

let n = 0
function alvoCom(conteudo: string): string {
  const alvo = join(BASE, `alvo-${n++}`)
  mkdirSync(join(alvo, '.hii', 'memory'), { recursive: true })
  writeFileSync(join(alvo, '.hii', 'memory', 'motor.md'), conteudo)
  return alvo
}

function linhas(quantas: number, rotulo: string): string {
  return Array.from({ length: quantas }, (_, i) => `- #${String(i).padStart(3, '0')} ${rotulo} com texto suficiente para ocupar espaco real na memoria do projeto`).join('\n')
}

test('alvo sem memoria devolve vazio, nao erro', () => {
  expect(readProjectMemory(join(BASE, 'alvo-inexistente'))).toBe('')
})

test('memoria curta volta inteira', () => {
  const alvo = alvoCom('- #001 primeira decisao\n- #002 segunda decisao\n')
  const m = readProjectMemory(alvo)
  expect(m).toContain('primeira decisao')
  expect(m).toContain('segunda decisao')
})

test('memoria maior que o teto mantem o RECENTE, nao o antigo', () => {
  const alvo = alvoCom(`${linhas(60, 'decisao antiga')}\n- #999 a decisao mais recente de todas\n`)
  const m = readProjectMemory(alvo)
  expect(m.length).toBeLessThanOrEqual(TETO_DA_MEMORIA + 200)
  expect(m, 'cortar pelo fim congela a memoria no passado e o aprendizado novo nunca chega ao prompt').toContain('a decisao mais recente de todas')
  expect(m).not.toContain('#000 decisao antiga')
})

test('quando corta, DIZ que cortou — truncagem silenciosa e degradacao invisivel', () => {
  const alvo = alvoCom(linhas(60, 'decisao antiga'))
  expect(readProjectMemory(alvo)).toContain('memoria truncada')
})

test('appendProjectMemory acrescenta e o que foi escrito por ultimo sobrevive ao teto', () => {
  const alvo = alvoCom(linhas(60, 'decisao antiga'))
  appendProjectMemory(alvo, 'decisao acabada de tomar neste card')
  expect(readProjectMemory(alvo)).toContain('decisao acabada de tomar neste card')
})
