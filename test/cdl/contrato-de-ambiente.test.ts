import { test, expect } from '../apoio/runner.ts'
import { CONTRATO_MOTOR_PAINEL } from '../../motor/cdl/ali/contrato.ts'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

test('REGRESSAO todo estado compartilhado por ARQUIVO esta no contrato de ambiente', () => {
  const declaradas = new Set(CONTRATO_MOTOR_PAINEL.map(v => v.nome))
  const fora: string[] = []
  let varridos = 0
  const varrer = (dir: string): void => {
    for (const it of readdirSync(dir, { withFileTypes: true })) {
      if (it.name === 'node_modules') continue
      const caminho = join(dir, it.name)
      if (it.isDirectory()) { varrer(caminho); continue }
      if (!it.name.endsWith('.ts')) continue
      varridos++
      const fonte = readFileSync(caminho, 'utf8')
      for (const m of fonte.matchAll(/process\.env\.(HICODE_[A-Z_]*(?:FILE|DIR|PIDFILE|LOCK))\b/g)) {
        const nome = m[1] ?? ''
        if (nome && !declaradas.has(nome)) fora.push(`${caminho}: ${nome}`)
      }
    }
  }
  varrer('motor')
  // Guarda contra vacuidade. Este teste varria 'lib', e depois da Onda 1 um
  // diretorio lib/ VAZIO sobrou em disco: readdirSync passava, nao encontrava
  // nada, e o guarda aprovava sem verificar coisa nenhuma. So quebrou quando o
  // diretorio sumiu de vez. Varredura que pode virar no-op em silencio e pior
  // que varredura nenhuma.
  expect(varridos, 'a varredura nao encontrou fonte — a raiz mudou de lugar de novo?').toBeGreaterThan(150)
  expect(fora, 'variavel que aponta para arquivo/dir compartilhado e nao esta no contrato entre os repos').toEqual([])
})
