import { test, expect, beforeEach, afterEach } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { comandoDoPipeline } from '../../motor/oswaldo/orquestracao/comando.ts'
import { aplicarSetup, efetuarPassoSetup, planejarSetup, registrarPlanoSetup } from '../../motor/euclides/setup.ts'

let dir = '', repo = ''
let anterior: NodeJS.ProcessEnv
beforeEach(() => {
  anterior = { ...process.env }
  dir = mkdtempSync(join(tmpdir(), 'hii-setup-'))
  repo = join(dir, 'projeto com espacos')
  mkdirSync(repo)
  process.env.HII_CARDS_DIR = join(dir, 'cards')
  process.env.HII_REPOS_FILE = join(dir, 'repos.json')
  writeFileSync(process.env.HII_REPOS_FILE, JSON.stringify([{ name: 'org/app', path: repo }]))
})
afterEach(() => { process.env = anterior; rmSync(dir, { recursive: true, force: true }) })
function previa(): string {
  const texto = comandoDoPipeline('org/app', 'setup').join('\n')
  const hash = texto.match(/[a-f0-9]{64}/)?.[0]
  expect(!!hash).toBe(true)
  return hash!
}
test('setup apresenta plano antes de alterar o projeto', () => {
  previa()
  expect(existsSync(join(repo, '.hii'))).toBe(false)
})
test('aplicar duas vezes conserva valores editados e nao duplica arquivos', () => {
  const hash = previa()
  comandoDoPipeline('org/app', 'setup apply ' + hash)
  expect(existsSync(join(repo, '.hii', 'rules.md'))).toBe(true)
  writeFileSync(join(repo, '.hii', 'config.json'), '{"preferencia":"humana"}')
  comandoDoPipeline('org/app', 'setup apply ' + hash)
  expect(readFileSync(join(repo, '.hii', 'config.json'), 'utf8')).toBe('{"preferencia":"humana"}')
})
test('reversao preserva edicao posterior do usuario e explica a pendencia', () => {
  const hash = previa()
  comandoDoPipeline('org/app', 'setup apply ' + hash)
  writeFileSync(join(repo, '.hii', 'rules.md'), 'regra editada apos setup')
  const saida = comandoDoPipeline('org/app', 'setup undo ' + hash).join('\n')
  expect(readFileSync(join(repo, '.hii', 'rules.md'), 'utf8')).toBe('regra editada apos setup')
  expect(existsSync(join(repo, '.hii', 'config.json'))).toBe(false)
  expect(saida).toContain('preservado')
})
test('falha parcial fica registrada e a repeticao do mesmo plano retoma sem duplicar efeitos', () => {
  const plano = planejarSetup(repo)
  registrarPlanoSetup(plano)
  let chamadas = 0
  const parcial = aplicarSetup(plano.hash, repo, undefined, (passo, caminho) => {
    if (++chamadas === 3) throw new Error('falha controlada no terceiro passo')
    efetuarPassoSetup(passo, caminho)
  })
  expect(parcial.ok).toBe(false)
  expect(parcial.linhas.join('\n')).toContain('diario preservado')
  expect(existsSync(join(repo, '.hii'))).toBe(true)
  expect(existsSync(join(repo, '.hii', 'skills'))).toBe(false)

  const retomada = aplicarSetup(plano.hash, repo)
  expect(retomada.ok).toBe(true)
  expect(existsSync(join(repo, '.hii', 'skills'))).toBe(true)
  expect(readFileSync(join(repo, '.hii', 'rules.md'), 'utf8').length > 0).toBe(true)
})
