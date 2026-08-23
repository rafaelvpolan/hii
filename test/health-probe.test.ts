import { test, expect, afterAll } from 'bun:test'
import { probeProviderHealth } from '../motor/tmd/registro'

let statusCode = 200
const server = Bun.serve({
  port: 0,
  fetch(): Response {
    return new Response('', { status: statusCode })
  },
})
const baseUrl = `http://localhost:${server.port}`

afterAll(() => server.stop(true))

test('provedor com string vazia: nao sonda, assume saudavel (nada a checar)', async () => {
  expect(await probeProviderHealth('')).toBe(true)
})

test('provedor sem endpoint conhecido assume saudavel sem sondar a rede', async () => {
  expect(await probeProviderHealth('provedor-sem-endpoint')).toBe(true)
})

test('ollama: http 200 na url configurada e saudavel', async () => {
  statusCode = 200
  process.env.HICODE_OLLAMA_URL = baseUrl
  expect(await probeProviderHealth('ollama')).toBe(true)
})

test('ollama: 5xx do proprio servidor local conta como insalubre', async () => {
  statusCode = 503
  process.env.HICODE_OLLAMA_URL = baseUrl
  expect(await probeProviderHealth('ollama')).toBe(false)
})

test('ollama: porta sem ninguem escutando e insalubre (nao trava, nao lanca)', async () => {
  process.env.HICODE_OLLAMA_URL = 'http://localhost:1'
  expect(await probeProviderHealth('ollama')).toBe(false)
})

test('REGRESSAO kimi sonda a API de verdade — antes caia num true implicito', async () => {
  statusCode = 200
  process.env.HICODE_KIMI_URL = baseUrl
  expect(await probeProviderHealth('kimi')).toBe(true)
})

test('REGRESSAO kimi fora do ar e insalubre — o motor nao pode achar que esta de pe', async () => {
  process.env.HICODE_KIMI_URL = 'http://localhost:1'
  expect(await probeProviderHealth('kimi')).toBe(false)
})
