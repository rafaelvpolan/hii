import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { detectRuntimes, normalizarVersao, runtimesDoPacote } from '../../motor/cordel/bussola/runtimes.ts'
import { probeContract } from '../../motor/cordel/bussola/sondar.ts'
import { devCommand, resolveCommand } from '../../motor/mirante/comandos.ts'

const feitos: string[] = []
afterAll(() => { for (const d of feitos) rmSync(d, { recursive: true, force: true }) })
function repo(): string { const d = mkdtempSync(join(tmpdir(), 'hii-runtimes-')); feitos.push(d); return d }
function escrever(dir: string, nome: string, conteudo: string): void { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, nome), conteudo) }

const SEM_GERENTE = { disponiveis: [], nvmSh: '' } as const
const COM_MISE = { disponiveis: ['mise'], nvmSh: '' } as const

test('normalizarVersao: tira o v, pega a primeira versao numerica de um range e preserva apelidos que os gerentes entendem', () => {
  expect(normalizarVersao('v20.11.0')).toBe('20.11.0')
  expect(normalizarVersao('^8.2')).toBe('8.2')
  expect(normalizarVersao('>=18 <21')).toBe('18')
  expect(normalizarVersao('18.x')).toBe('18')
  expect(normalizarVersao('lts/iron')).toBe('lts/iron')
  expect(normalizarVersao('')).toBe('')
})

test('detectRuntimes le .nvmrc, engines.node, .tool-versions, composer.json e .php-version — e a fonte mais especifica ganha', () => {
  const r = repo()
  escrever(r, '.nvmrc', 'v18.19.0\n')
  escrever(r, 'package.json', JSON.stringify({ name: 'a', engines: { node: '>=20' } }))
  escrever(r, 'composer.json', JSON.stringify({ require: { php: '^8.2' }, config: { platform: { php: '8.2.12' } } }))
  expect(detectRuntimes(r)).toEqual([
    { linguagem: 'node', versao: '18.19.0', fonte: '.nvmrc' },
    { linguagem: 'php', versao: '8.2.12', fonte: 'composer.json#config.platform.php' },
  ])
  const s = repo()
  escrever(s, '.tool-versions', '# comentario\nnodejs 20.5.1\nphp 8.3.2\npython 3.12\n')
  expect(detectRuntimes(s)).toEqual([
    { linguagem: 'node', versao: '20.5.1', fonte: '.tool-versions' },
    { linguagem: 'php', versao: '8.3.2', fonte: '.tool-versions' },
  ])
})

test('o pacote herda do raiz o que nao declara, e a fonte diz que veio da raiz', () => {
  const r = repo()
  escrever(r, '.tool-versions', 'nodejs 20\nphp 8.3\n')
  escrever(join(r, 'legado'), '.nvmrc', '16\n')
  expect(runtimesDoPacote(r, 'legado')).toEqual([
    { linguagem: 'node', versao: '16', fonte: '.nvmrc' },
    { linguagem: 'php', versao: '8.3', fonte: 'raiz/.tool-versions' },
  ])
})

test('MONOLITO MODULAR: web em Node e api em PHP (Laravel) no mesmo repo viram dois pacotes, cada um com seus comandos e runtimes', () => {
  const r = repo()
  escrever(r, '.tool-versions', 'nodejs 20\n')
  escrever(join(r, 'web'), 'package.json', JSON.stringify({ name: 'web', scripts: { build: 'vite build', dev: 'vite', test: 'vitest' }, dependencies: { vue: '^3', vite: '^5' } }))
  escrever(join(r, 'web'), '.nvmrc', '18\n')
  escrever(join(r, 'api'), 'composer.json', JSON.stringify({ name: 'acme/api', require: { php: '^8.2', 'laravel/framework': '^11' }, 'require-dev': { 'phpunit/phpunit': '^11', 'laravel/pint': '^1' }, scripts: { lint: 'pint' } }))
  const c = probeContract(r, '2026-09-12T00:00:00Z')
  expect(c.shape).toBe('poly')
  expect(c.packages.map(p => [p.path, p.language, p.framework, p.packageManager])).toEqual([
    ['api', 'PHP', 'Laravel', 'composer'],
    ['web', 'JavaScript', 'Vue 3', 'npm'],
  ])
  const api = c.packages[0]
  expect(api?.commands).toMatchObject({ install: 'composer install', test: 'php artisan test', lint: 'composer run-script lint', dev: 'php artisan serve --host 127.0.0.1 --port {port}' })
  expect(api?.runtimes).toEqual([{ linguagem: 'php', versao: '8.2', fonte: 'composer.json#require.php' }, { linguagem: 'node', versao: '20', fonte: 'raiz/.tool-versions' }])
  expect(c.packages[1]?.runtimes).toEqual([{ linguagem: 'node', versao: '18', fonte: '.nvmrc' }])
  expect(c.sources.some(s => s.ref === 'api/composer.json'), 'composer.json do pacote entra no hash do contrato').toBe(true)

  const dev = devCommand(c, 5207, api, SEM_GERENTE)
  expect(dev?.cmd).toBe('php')
  expect(dev?.args).toEqual(['artisan', 'serve', '--host', '127.0.0.1', '--port', '5207'])
  expect(dev?.label).toContain('--port 5207')
  expect(dev?.avisosDeRuntime.join(' ')).toContain('php 8.2 declarado em composer.json#require.php, mas nenhum gerente')

  const teste = resolveCommand(c, 'test', '/wt', api, COM_MISE)
  expect(teste?.cmd).toBe('mise')
  expect(teste?.args).toEqual(['exec', 'node@20', '--', 'mise', 'exec', 'php@8.2', '--', 'php', 'artisan', 'test'])
  expect(teste?.runtime).toBe('php 8.2 via mise · node 20 via mise')
  expect(teste?.cwd).toBe('/wt/api')
})

test('PHP puro na raiz (sem package.json) tambem vira contrato: php -S com {port} quando ha public/index.php', () => {
  const r = repo()
  escrever(r, 'composer.json', JSON.stringify({ name: 'acme/site', require: { php: '>=8.1' } }))
  escrever(join(r, 'public'), 'index.php', '<?php echo 1;')
  const c = probeContract(r, '2026-09-12T00:00:00Z')
  expect(c.shape).toBe('single')
  expect(c.packageManager).toBe('composer')
  expect(c.stack).toContain('PHP')
  const dev = devCommand(c, 5200, undefined, SEM_GERENTE)
  expect(dev?.args).toEqual(['-S', '127.0.0.1:5200', '-t', 'public'])
})

test('sem script de dev o preview NAO some: start:dev conta como dev; sem script nenhum, index.html em public/ vira o live server do motor; manage.py vira runserver', () => {
  const a = repo()
  escrever(a, 'package.json', JSON.stringify({ name: 'a', scripts: { 'start:dev': 'nodemon server.js' } }))
  expect(probeContract(a, 'x').commands.dev).toBe('npm run start:dev')

  const b = repo()
  escrever(b, 'package.json', JSON.stringify({ name: 'b', scripts: { build: 'esbuild' } }))
  escrever(join(b, 'public'), 'index.html', '<html></html>')
  const cb = probeContract(b, 'x')
  expect(cb.commands.dev).toBe('{servidor-estatico} --dir public --port {port}')
  const dev = devCommand(cb, 5210, undefined, SEM_GERENTE)
  expect(dev?.cmd === 'bun' || dev?.cmd === 'node', 'roda no runtime do MOTOR, nao no do alvo').toBe(true)
  expect(dev?.args.slice(1)).toEqual(['--dir', 'public', '--port', '5210'])
  expect(dev?.args[0]?.endsWith('scripts/servidor-estatico.mjs')).toBe(true)
  expect(dev?.runtime).toBe('live server do motor')

  const c = repo()
  escrever(c, 'manage.py', '')
  escrever(c, 'package.json', JSON.stringify({ name: 'c' }))
  expect(probeContract(c, 'x').commands.dev).toBe('python3 manage.py runserver 127.0.0.1:{port}')
})

test('site em HTML puro, sem manifesto nenhum, vira contrato com preview pelo live server', () => {
  const r = repo()
  escrever(r, 'index.html', '<html><body>oi</body></html>')
  const c = probeContract(r, 'x')
  expect(c.packages.length).toBe(1)
  expect(c.packages[0]?.language).toBe('HTML')
  expect(c.commands.dev).toBe('{servidor-estatico} --dir . --port {port}')
  expect(c.stack).toContain('site estatico')
})
