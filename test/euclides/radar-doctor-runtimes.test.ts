import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { checkRuntimes } from '../../motor/euclides/radar/doctor.ts'

const BASE = mkdtempSync(join(tmpdir(), 'hii-doctor-rt-'))
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

function contrato(dir: string, runtimes: Array<{ linguagem: 'node' | 'php'; versao: string; fonte: string }>): void {
  mkdirSync(join(dir, '.hii'), { recursive: true })
  const commands = { install: '', build: '', test: '', lint: '', typecheck: '', dev: '' }
  writeFileSync(join(dir, '.hii', 'contract.json'), JSON.stringify({
    version: 1, generated: 'x', hash: 'x', shape: 'single', packageManager: 'npm', monorepo: false, main: '', stack: 'js', sources: [], commands,
    packages: [{ name: 'app', path: '', framework: '', language: 'TypeScript', packageManager: 'npm', scripts: [], devPort: 0, commands, runtimes }],
  }))
}

test('sem versao declarada o doctor diz que o PATH manda; com gerente presente, ok e o comando de instalar caso falte', () => {
  const a = join(BASE, 'a'); contrato(a, [])
  expect(checkRuntimes(a, { disponiveis: [], nvmSh: '' })).toMatchObject({ severidade: 'ok', detalhe: 'nenhuma versao de node/php declarada — comandos do alvo rodam com o PATH' })
  const b = join(BASE, 'b'); contrato(b, [{ linguagem: 'node', versao: '18', fonte: '.nvmrc' }])
  const r = checkRuntimes(b, { disponiveis: ['mise'], nvmSh: '' })
  expect(r.severidade).toBe('ok')
  expect(r.detalhe).toContain('node 18 via mise')
  expect(r.conserto).toContain('mise install node@18')
})

test('versao declarada, sem gerente e com PATH de outra major: aviso nomeando a fonte e o conserto', () => {
  const c = join(BASE, 'c'); contrato(c, [{ linguagem: 'node', versao: '4', fonte: '.nvmrc' }])
  const r = checkRuntimes(c, { disponiveis: [], nvmSh: '' })
  expect(r.severidade).toBe('aviso')
  expect(r.detalhe).toContain('node 4 declarado em .nvmrc')
  expect(r.detalhe).toContain('nao ha gerente de versao')
  expect(r.conserto).toContain('mise install node@4')
})
