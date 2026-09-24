import { test, expect, beforeEach, afterEach } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { comandoDoPipeline } from '../../motor/oswaldo/orquestracao/comando.ts'
import { aplicarSetup, efetuarPassoSetup, planejarSetup, registrarPlanoSetup, reverterSetup } from '../../motor/euclides/setup.ts'

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

test('migra .hicode automaticamente, completa o scaffold e reverte sem perder memoria', () => {
  mkdirSync(join(repo, '.hicode', 'memory'), { recursive: true })
  writeFileSync(join(repo, '.hicode', 'rules.md'), 'regra legada preservada')
  writeFileSync(join(repo, '.hicode', 'memory', 'produto.md'), 'decisao antiga')
  const hash = previa()
  const saida = comandoDoPipeline('org/app', 'setup apply ' + hash).join('\n')
  expect(saida).toContain('migrar-legado: aplicado')
  expect(existsSync(join(repo, '.hicode'))).toBe(false)
  expect(readFileSync(join(repo, '.hii', 'rules.md'), 'utf8')).toBe('regra legada preservada')
  expect(readFileSync(join(repo, '.hii', 'memory', 'produto.md'), 'utf8')).toBe('decisao antiga')
  expect(existsSync(join(repo, '.hii', 'config.json'))).toBe(true)

  const reversao = comandoDoPipeline('org/app', 'setup undo ' + hash).join('\n')
  expect(reversao).toContain('migrar-legado: revertido')
  expect(existsSync(join(repo, '.hii'))).toBe(false)
  expect(readFileSync(join(repo, '.hicode', 'rules.md'), 'utf8')).toBe('regra legada preservada')
  expect(readFileSync(join(repo, '.hicode', 'memory', 'produto.md'), 'utf8')).toBe('decisao antiga')
})

test('crash depois do rename legado reconcilia pela identidade e nao repete o efeito', () => {
  mkdirSync(join(repo, '.hicode'))
  writeFileSync(join(repo, '.hicode', 'rules.md'), 'legado')
  const plano = planejarSetup(repo)
  registrarPlanoSetup(plano)
  let migracoes = 0
  const parcial = aplicarSetup(plano.hash, repo, undefined, (passo, caminho) => {
    efetuarPassoSetup(passo, caminho)
    if (passo.id === 'migrar-legado') { migracoes++; throw new Error('resposta perdida depois do rename') }
  })
  expect(parcial.ok).toBe(false)
  expect(existsSync(join(repo, '.hicode'))).toBe(false)
  expect(readFileSync(join(repo, '.hii', 'rules.md'), 'utf8')).toBe('legado')

  const retomada = aplicarSetup(plano.hash, repo, undefined, (passo, caminho) => {
    if (passo.id === 'migrar-legado') migracoes++
    efetuarPassoSetup(passo, caminho)
  })
  expect(retomada.ok).toBe(true)
  expect(migracoes).toBe(1)
  expect(readFileSync(join(repo, '.hii', 'rules.md'), 'utf8')).toBe('legado')
})

test('plano antigo, destinos concorrentes e symlink bloqueiam sem sobrescrever', () => {
  const hash = previa()
  mkdirSync(join(repo, '.hii'))
  writeFileSync(join(repo, '.hii', 'rules.md'), 'conteudo posterior a previa')
  expect(comandoDoPipeline('org/app', 'setup apply ' + hash).join('\n')).toContain('mudou depois da previa')
  expect(readFileSync(join(repo, '.hii', 'rules.md'), 'utf8')).toBe('conteudo posterior a previa')
  rmSync(join(repo, '.hii'), { recursive: true })

  const fora = join(dir, 'fora')
  mkdirSync(fora)
  symlinkSync(fora, join(repo, '.hii'))
  expect(comandoDoPipeline('org/app', 'setup').join('\n')).toContain('symlink')
  expect(existsSync(join(fora, 'config.json'))).toBe(false)
})

test('selecao parcial inclui dependencias e nao cria os demais itens', () => {
  const hash = previa()
  expect(comandoDoPipeline('org/app', 'setup apply ' + hash + ' config').join('\n')).toContain('config: aplicado')
  expect(existsSync(join(repo, '.hii', 'config.json'))).toBe(true)
  expect(existsSync(join(repo, '.hii', 'rules.md'))).toBe(false)
  expect(existsSync(join(repo, '.hii', 'memory'))).toBe(false)
})

test('reversao preserva origem recriada e destino alterado por outra operacao', () => {
  mkdirSync(join(repo, '.hicode'))
  writeFileSync(join(repo, '.hicode', 'rules.md'), 'legado')
  const plano = planejarSetup(repo)
  registrarPlanoSetup(plano)
  expect(aplicarSetup(plano.hash, repo).ok).toBe(true)
  mkdirSync(join(repo, '.hicode'))
  writeFileSync(join(repo, '.hicode', 'externo.md'), 'novo legado concorrente')
  const r = reverterSetup(plano.hash, repo)
  expect(r.ok).toBe(false)
  expect(r.linhas.join('\n')).toContain('migrar-legado: preservado')
  expect(readFileSync(join(repo, '.hicode', 'externo.md'), 'utf8')).toBe('novo legado concorrente')
  expect(readFileSync(join(repo, '.hii', 'rules.md'), 'utf8')).toBe('legado')
})

test('coexistencia de memorias ou legado que nao seja diretorio exige decisao humana', () => {
  mkdirSync(join(repo, '.hicode'))
  mkdirSync(join(repo, '.hii'))
  expect(comandoDoPipeline('org/app', 'setup').join('\n')).toContain('escolha humana necessaria')

  rmSync(join(repo, '.hicode'), { recursive: true })
  rmSync(join(repo, '.hii'), { recursive: true })
  writeFileSync(join(repo, '.hicode'), 'nao e uma memoria valida')
  expect(comandoDoPipeline('org/app', 'setup').join('\n')).toContain('nao e um diretorio')
})
