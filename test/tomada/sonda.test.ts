import { test, expect, afterAll, servidorDeTeste } from '../apoio/runner.ts'
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { probeProviderHealth, sabeSondarProvedor } from '../../motor/tomada/registro.ts'
import { binarioResponde, cliSaudavel } from '../../motor/tomada/sonda.ts'

const BIN_FALSO = mkdtempSync(join(tmpdir(), 'hicode-sonda-bin-'))
writeFileSync(join(BIN_FALSO, 'kimi'), '#!/bin/sh\necho 0.38.0\n')
chmodSync(join(BIN_FALSO, 'kimi'), 0o755)
process.env.PATH = `${BIN_FALSO}:${process.env.PATH ?? ''}`

let statusCode = 200
const server = await servidorDeTeste(function fetch(): Response {
    return new Response('', { status: statusCode })
  })
const baseUrl = `http://localhost:${server.port}`

afterAll(() => { server.stop(true); rmSync(BIN_FALSO, { recursive: true, force: true }) })

test('provedor com string vazia: nao sonda, assume saudavel (nada a checar)', async () => {
  expect(await probeProviderHealth('')).toBe(true)
})

test('provedor sem endpoint conhecido assume saudavel sem sondar a rede', async () => {
  expect(await probeProviderHealth('provedor-sem-endpoint')).toBe(true)
})

test('ollama: http 200 na url configurada e saudavel', async () => {
  statusCode = 200
  process.env.HII_OLLAMA_URL = baseUrl
  expect(await probeProviderHealth('ollama')).toBe(true)
})

test('ollama: 5xx do proprio servidor local conta como insalubre', async () => {
  statusCode = 503
  process.env.HII_OLLAMA_URL = baseUrl
  expect(await probeProviderHealth('ollama')).toBe(false)
})

test('ollama: porta sem ninguem escutando e insalubre (nao trava, nao lanca)', async () => {
  process.env.HII_OLLAMA_URL = 'http://localhost:1'
  expect(await probeProviderHealth('ollama')).toBe(false)
})

test('REGRESSAO kimi sonda a API de verdade — antes caia num true implicito', async () => {
  statusCode = 200
  process.env.HII_KIMI_URL = baseUrl
  expect(await probeProviderHealth('kimi')).toBe(true)
})

test('REGRESSAO kimi fora do ar e insalubre — o motor nao pode achar que esta de pe', async () => {
  process.env.HII_KIMI_URL = 'http://localhost:1'
  expect(await probeProviderHealth('kimi')).toBe(false)
})

test('REGRESSAO 429 NAO e saudavel — cota estourada e exatamente "indisponivel agora", e antes acordava o card para falhar de novo', async () => {
  statusCode = 429
  process.env.HII_OLLAMA_URL = baseUrl
  expect(await probeProviderHealth('ollama')).toBe(false)
})

test('REGRESSAO 403 NAO e saudavel — endpoint que recusa credencial nao prova provedor de pe', async () => {
  statusCode = 403
  process.env.HII_OLLAMA_URL = baseUrl
  expect(await probeProviderHealth('ollama')).toBe(false)
})

test('408 NAO e saudavel — o servidor dizendo que a requisicao expirou nao pode contar como alcance', async () => {
  statusCode = 408
  process.env.HII_OLLAMA_URL = baseUrl
  expect(await probeProviderHealth('ollama')).toBe(false)
})

test('404 segue saudavel: a url pode nao existir e o provedor estar de pe — a sonda mede ALCANCE, nao rota', async () => {
  statusCode = 404
  process.env.HII_OLLAMA_URL = baseUrl
  expect(await probeProviderHealth('ollama')).toBe(true)
})

test('sabeSondarProvedor separa "sondei e esta de pe" de "nao tenho como sondar" — o true dos dois casos era indistinguivel', () => {
  expect(sabeSondarProvedor('ollama')).toBe(true)
  expect(sabeSondarProvedor('')).toBe(false)
  expect(sabeSondarProvedor('provedor-sem-endpoint')).toBe(false)
})

test('binarioResponde: binario no PATH que responde --version e saudavel; ausente nao e', async () => {
  expect(await binarioResponde('kimi')).toBe(true)
  expect(await binarioResponde('binario-que-nao-existe-nesta-maquina')).toBe(false)
})

test('cliSaudavel e E, nao OU: API 200 com binario ausente NAO e saude — foi um GET assim que "curou" um CLI travado por 900s', async () => {
  statusCode = 200
  expect(await cliSaudavel('binario-que-nao-existe-nesta-maquina', baseUrl)).toBe(false)
  expect(await cliSaudavel('kimi', baseUrl)).toBe(true)
})

test('cliSaudavel: binario vivo com API fora do ar tambem nao e saude', async () => {
  expect(await cliSaudavel('kimi', 'http://localhost:1')).toBe(false)
})
