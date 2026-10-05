import { test, beforeEach, afterEach, expect } from '../apoio/runner.ts'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { criarServidorApi } from '../../motor/api/servidor.ts'
import { createCard, readCard } from '../../motor/cordel/store.ts'
import { liberarPeloPacote } from '../../motor/niemeyer/lucio/aprovacao-do-pacote.ts'

const token = 'teste-ia-da-tarefa-sem-credenciais-123456789'
let base = ''
let url = ''
let servidor: Server
let numero = 0

beforeEach(async () => {
  base = mkdtempSync(join(tmpdir(), 'hii-api-ia-'))
  process.env.HII_CARDS_DIR = join(base, 'cards')
  process.env.HII_REPOS_FILE = join(base, 'repos.json')
  mkdirSync(join(base, 'projeto'))
  writeFileSync(process.env.HII_REPOS_FILE, JSON.stringify([{ name: 'org/app', path: join(base, 'projeto') }]))
  servidor = criarServidorApi(token)
  await new Promise<void>(resolve => servidor.listen(0, '127.0.0.1', resolve))
  const endereco = servidor.address()
  assert.ok(endereco && typeof endereco !== 'string')
  url = `http://127.0.0.1:${endereco.port}`
})
afterEach(async () => {
  const fim = new Promise<void>(resolve => servidor.close(() => resolve()))
  servidor.closeAllConnections()
  await fim
  rmSync(base, { recursive: true, force: true })
})

function cabecalhos(extras: Record<string, string> = {}): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...extras }
}

function tarefa(): string {
  return createCard({ title: 'ajustar header', status: 'EXECUTING', repo: 'org/app' }, '## Objetivo\najustar header\n')
}

test('GET /ia mostra a IA de cada papel do card com etag', async () => {
  const id = tarefa()
  const r = await fetch(`${url}/v1/tarefas/${id}/ia`, { headers: cabecalhos() })
  expect(r.status).toBe(200)
  const corpo = await r.json() as { papeis: string[]; ias: { papel: string; provedor: string }[] }
  expect(corpo.papeis).toEqual(['implement', 'verify', 'gate', 'step'])
  expect(corpo.ias.every(i => i.provedor === '')).toBe(true)
  expect(r.headers.get('etag')).toBeTruthy()
})

test('POST /ia define a IA do card com If-Match e recusa revisao velha', async () => {
  const id = tarefa()
  const etag = (await fetch(`${url}/v1/tarefas/${id}/ia`, { headers: cabecalhos() })).headers.get('etag') ?? ''
  const ok = await fetch(`${url}/v1/tarefas/${id}/ia`, { method: 'POST', headers: cabecalhos({ 'if-match': etag, 'idempotency-key': `ia-da-tarefa-${++numero}` }), body: JSON.stringify({ papel: 'implement', provedor: 'codex' }) })
  expect(ok.status).toBe(200)
  expect(readCard(id)?.fm.provider_override_implement).toBe('codex')
  const velho = await fetch(`${url}/v1/tarefas/${id}/ia`, { method: 'POST', headers: cabecalhos({ 'if-match': etag, 'idempotency-key': `ia-da-tarefa-${++numero}` }), body: JSON.stringify({ papel: 'implement', provedor: 'claude' }) })
  expect(velho.status).toBe(412)
  expect(readCard(id)?.fm.provider_override_implement).toBe('codex')
})

test('POST /ia recusa provedor desconhecido e exige If-Match', async () => {
  const id = tarefa()
  const semRevisao = await fetch(`${url}/v1/tarefas/${id}/ia`, { method: 'POST', headers: cabecalhos({ 'idempotency-key': `ia-da-tarefa-${++numero}` }), body: JSON.stringify({ papel: 'implement', provedor: 'codex' }) })
  expect(semRevisao.status).toBe(428)
  const etag = (await fetch(`${url}/v1/tarefas/${id}/ia`, { headers: cabecalhos() })).headers.get('etag') ?? ''
  const invalido = await fetch(`${url}/v1/tarefas/${id}/ia`, { method: 'POST', headers: cabecalhos({ 'if-match': etag, 'idempotency-key': `ia-da-tarefa-${++numero}` }), body: JSON.stringify({ papel: 'implement', provedor: 'ia-inventada' }) })
  expect(invalido.status).toBe(400)
})

test('GET /pacote devolve o prompt e as recomendacoes para o painel aprovar', async () => {
  const id = tarefa()
  liberarPeloPacote(id)
  const r = await fetch(`${url}/v1/tarefas/${id}/pacote`, { headers: cabecalhos() })
  expect(r.status).toBe(200)
  const corpo = await r.json() as { status: string; hash: string; markdown: string }
  expect(corpo.status).toBe('aguardando')
  expect(corpo.hash).toBeTruthy()
  expect(corpo.markdown).toContain('## Prompt do implementador')
})

test('configuracao mostra troca por cota, prompt primeiro e limites', async () => {
  const r = await fetch(`${url}/v1/configuracao`, { headers: cabecalhos() })
  const corpo = await r.json() as { execucao: { trocaPorCota: string; promptPrimeiro: boolean }; limites: { tetoUsdPorCard: number; tetoTokensPorCard: number }; iaPorTarefa: string }
  expect(corpo.execucao.trocaPorCota).toBe('perguntar')
  expect(corpo.execucao.promptPrimeiro).toBe(true)
  expect(corpo.limites.tetoUsdPorCard).toBeGreaterThan(0)
  expect(corpo.limites.tetoTokensPorCard).toBeGreaterThan(0)
  expect(corpo.iaPorTarefa).toBe('/v1/tarefas/{id}/ia')
})
