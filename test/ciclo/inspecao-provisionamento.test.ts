// Onda 2 do raio-x: em producao a inspecao visual era SEMPRE inconclusiva por
// construcao — playwright e devDependency, o Dockerfile roda --omit=dev e o
// import estatico derrubava o script sem imprimir JSON; "playwright ausente"
// (provisionamento) e "pagina inacessivel" (o repo-alvo quebrou) viravam a mesma
// frase generica. Agora cada modo de falha tem o proprio veredito parseavel, e o
// de provisionamento diz o conserto (--build-arg COM_PREVIEW=1).
import { test, expect, rodar } from '../apoio/runner.ts'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('../../scripts/inspect-preview.mjs', import.meta.url))
const FORA = mkdtempSync(join(tmpdir(), 'hicode-inspecao-'))

interface VereditoDaInspecao {
  ok: boolean
  conclusive: boolean
  detail: string
}

async function rodarScript(caminho: string, url: string): Promise<VereditoDaInspecao> {
  const r = await rodar([process.execPath, caminho, url], {}).saida()
  expect(r.code, r.stderr).toBe(0)
  return JSON.parse(r.stdout) as VereditoDaInspecao
}

test('sem playwright alcancavel, o veredito nomeia PROVISIONAMENTO e traz o conserto — nao culpa a pagina', async () => {
  const copiado = join(FORA, 'inspect-preview.mjs')
  writeFileSync(copiado, readFileSync(SCRIPT, 'utf8').replace("import('playwright')", "import('/pacote-que-nao-existe/playwright.mjs')"))
  const v = await rodarScript(copiado, 'http://127.0.0.1:1')
  expect(v.ok).toBe(false)
  expect(v.conclusive).toBe(false)
  expect(v.detail).toContain('PROVISIONAMENTO')
  expect(v.detail).toContain('COM_PREVIEW=1')
  rmSync(FORA, { recursive: true, force: true })
}, 30000)

test('com playwright presente e pagina inacessivel, o veredito e o da PAGINA — os dois modos nao se confundem mais', async () => {
  const v = await rodarScript(SCRIPT, 'http://127.0.0.1:1')
  expect(v.ok).toBe(false)
  expect(v.conclusive).toBe(false)
  expect(v.detail).toContain('inspecao nao concluida')
  expect(v.detail).not.toContain('PROVISIONAMENTO')
}, 60000)
