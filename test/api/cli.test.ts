import { test } from '../apoio/runner.ts'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { openapi } from '../../motor/api/openapi.ts'

test('OpenAPI exportado corresponde ao contrato servido', () => {
  assert.deepEqual(JSON.parse(readFileSync('docs/conexao-hicode/openapi.json', 'utf8')), openapi)
})

test('documentacao da conexao tem links locais validos na pasta dedicada', () => {
  const pasta = 'docs/conexao-hicode'
  const docs = readdirSync(pasta).filter(f => f.endsWith('.md')).map(f => join(pasta, f))
  assert.ok(docs.length >= 5)
  for (const arquivo of docs) {
    for (const m of readFileSync(arquivo, 'utf8').matchAll(/\]\(([^)]+)\)/g)) {
      const alvo = m[1] ?? ''
      if (/^(https?:|#)/.test(alvo)) continue
      assert.ok(existsSync(resolve(dirname(arquivo), alvo.split('#')[0] ?? '')), `${arquivo}: link quebrado ${alvo}`)
    }
  }
})

test('hii api sobe sem daemon, responde handshake e termina por SIGTERM', async () => {
  const reserva = createServer()
  await new Promise<void>(resolve => reserva.listen(0, '127.0.0.1', resolve))
  const endereco = reserva.address()
  assert.ok(endereco && typeof endereco !== 'string')
  const porta = endereco.port
  await new Promise<void>(resolve => reserva.close(() => resolve()))
  const base = mkdtempSync(join(tmpdir(), 'hii-api-cli-'))
  const token = randomBytes(32).toString('hex')
  const child = spawn(process.execPath, ['bin/hii.ts', 'api'], {
    env: { ...process.env, HII_CARDS_DIR: join(base, 'cards'), HII_RUNNER_PIDFILE: join(base, 'runner.pid'), HII_API_PORT: String(porta), HII_API_HOST: '127.0.0.1', HII_API_TOKEN: token },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const encerrado = new Promise<number | null>(resolve => child.once('exit', resolve))
  const limite = setTimeout(() => child.kill('SIGKILL'), 12000)
  try {
    await new Promise<void>((resolve, reject) => {
      let log = ''
      child.stderr.on('data', (p: Buffer) => { log += p.toString(); if (log.includes('API v1 em')) resolve() })
      child.once('error', reject)
      child.once('exit', code => reject(new Error(`API saiu antes de pronta: ${code}; ${log}`)))
    })
    const r = await fetch(`http://127.0.0.1:${porta}/v1/capacidades`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) })
    assert.equal(r.status, 200)
    const dados = await r.json() as { protocolo: string }
    assert.equal(dados.protocolo, 'hii-http')
    child.kill('SIGTERM')
    assert.equal(await encerrado, 0)
  } finally {
    child.kill('SIGTERM')
    await encerrado
    clearTimeout(limite)
    rmSync(base, { recursive: true, force: true })
  }
}, 15000)
