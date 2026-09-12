import { test, expect, afterAll } from '../apoio/runner.ts'
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { envolverComRuntime, sondarGerentesAgora } from '../../motor/quilombo/gerente-de-versao.ts'
import { run } from '../../motor/quilombo/git.ts'

const BASE = mkdtempSync(join(tmpdir(), 'hii-gerente-'))
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const NODE18 = { linguagem: 'node', versao: '18', fonte: '.nvmrc' } as const
const PHP82 = { linguagem: 'php', versao: '8.2', fonte: 'composer.json#require.php' } as const

test('cada gerente envolve do seu jeito: mise e fnm por exec, asdf e phpenv por variavel, nvm por bash com os argumentos intactos', () => {
  expect(envolverComRuntime('npm', ['run', 'dev'], [NODE18], { disponiveis: ['mise'], nvmSh: '' })).toMatchObject({ cmd: 'mise', args: ['exec', 'node@18', '--', 'npm', 'run', 'dev'], env: {}, rotulo: 'node 18 via mise' })
  expect(envolverComRuntime('npm', ['test'], [NODE18], { disponiveis: ['asdf'], nvmSh: '' })).toMatchObject({ cmd: 'npm', args: ['test'], env: { ASDF_NODEJS_VERSION: '18' }, rotulo: 'node 18 via asdf' })
  expect(envolverComRuntime('npm', ['test'], [NODE18], { disponiveis: ['fnm', 'volta'], nvmSh: '' })).toMatchObject({ cmd: 'fnm', args: ['exec', '--using', '18', '--', 'npm', 'test'] })
  expect(envolverComRuntime('npm', ['test'], [NODE18], { disponiveis: ['volta'], nvmSh: '' })).toMatchObject({ cmd: 'volta', args: ['run', '--node', '18', 'npm', 'test'] })
  const nvm = envolverComRuntime('npm', ['run', 'dev', '--', '--port', '5201'], [NODE18], { disponiveis: ['nvm'], nvmSh: '/home/x/.nvm/nvm.sh' })
  expect(nvm.cmd).toBe('bash')
  expect(nvm.args.slice(0, 2)).toEqual(['-c', 'source "$0" >/dev/null 2>&1 && nvm exec --silent "$1" "${@:2}"'])
  expect(nvm.args.slice(2)).toEqual(['/home/x/.nvm/nvm.sh', '18', 'npm', 'run', 'dev', '--', '--port', '5201'])
  expect(envolverComRuntime('php', ['artisan', 'test'], [PHP82], { disponiveis: ['phpenv'], nvmSh: '' })).toMatchObject({ cmd: 'php', env: { PHPENV_VERSION: '8.2' }, rotulo: 'php 8.2 via phpenv' })
})

test('sem gerente o comando sai intacto, com aviso nomeando a fonte da versao; sem runtime declarado, nada muda e nao ha aviso', () => {
  const r = envolverComRuntime('npm', ['test'], [NODE18], { disponiveis: [], nvmSh: '' })
  expect(r).toMatchObject({ cmd: 'npm', args: ['test'], env: {}, rotulo: 'node 18 sem gerente' })
  expect(r.avisos[0]).toContain('node 18 declarado em .nvmrc, mas nenhum gerente (mise/asdf/fnm/volta/nvm)')
  expect(envolverComRuntime('npm', ['test'], [], { disponiveis: ['mise'], nvmSh: '' })).toMatchObject({ cmd: 'npm', args: ['test'], rotulo: '', avisos: [] })
  expect(envolverComRuntime('npm', ['test'], undefined, { disponiveis: ['mise'], nvmSh: '' }).rotulo).toBe('')
})

test('node e php juntos: o exec do node fica por fora e o do php por dentro; asdf mistura env dos dois', () => {
  const mise = envolverComRuntime('php', ['artisan', 'test'], [NODE18, PHP82], { disponiveis: ['mise'], nvmSh: '' })
  expect(mise.args).toEqual(['exec', 'node@18', '--', 'mise', 'exec', 'php@8.2', '--', 'php', 'artisan', 'test'])
  const asdf = envolverComRuntime('php', ['artisan', 'test'], [NODE18, PHP82], { disponiveis: ['asdf'], nvmSh: '' })
  expect(asdf.env).toEqual({ ASDF_PHP_VERSION: '8.2', ASDF_NODEJS_VERSION: '18' })
  expect(asdf.cmd).toBe('php')
})

test('sondarGerentesAgora acha binarios no PATH e o nvm.sh pelo NVM_DIR ou HOME', () => {
  const bin = join(BASE, 'bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, 'mise'), '#!/bin/sh\necho "$@"\n')
  chmodSync(join(bin, 'mise'), 0o755)
  const home = join(BASE, 'home')
  mkdirSync(join(home, '.nvm'), { recursive: true })
  writeFileSync(join(home, '.nvm', 'nvm.sh'), 'nvm() { shift; exec "$@"; }\n')
  const g = sondarGerentesAgora({ PATH: `${bin}:/usr/bin`, HOME: home })
  expect(g.disponiveis).toEqual(['mise', 'nvm'])
  expect(g.nvmSh).toBe(join(home, '.nvm', 'nvm.sh'))
  expect(sondarGerentesAgora({ PATH: '/nao/existe', HOME: join(BASE, 'vazio') }).disponiveis).toEqual([])
})

test('PONTA A PONTA: o comando envolvido roda de verdade — um mise falso recebe exatamente o exec que o motor montou, e o nvm falso executa o comando com os argumentos intactos', async () => {
  const bin = join(BASE, 'bin2')
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, 'mise'), '#!/bin/sh\necho "mise:$*"\n')
  chmodSync(join(bin, 'mise'), 0o755)
  const g = sondarGerentesAgora({ PATH: `${bin}:/usr/bin:/bin`, HOME: BASE })
  const m = envolverComRuntime('npm', ['run', 'dev'], [NODE18], g)
  const saida = await run(m.cmd, m.args, { env: { PATH: `${bin}:/usr/bin:/bin` }, timeout: 5000 })
  expect(saida.stdout.trim()).toBe('mise:exec node@18 -- npm run dev')

  const nvmSh = join(BASE, 'nvm-falso.sh')
  writeFileSync(nvmSh, 'nvm() { [ "$1" = exec ] && shift; [ "$1" = --silent ] && shift; shift; "$@"; }\n')
  const n = envolverComRuntime('printf', ['%s|%s', 'a b', 'c'], [NODE18], { disponiveis: ['nvm'], nvmSh })
  const r = await run(n.cmd, n.args, { timeout: 5000 })
  expect(r.stdout, 'argumento com espaco chega inteiro ao comando').toBe('a b|c')
})
