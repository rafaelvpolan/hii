import { test, beforeEach, afterEach, expect } from '../apoio/runner.ts'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { Server } from 'node:http'
import { criarServidorApi } from '../../motor/api/servidor.ts'
import { allCards, readCard, createCard } from '../../motor/cordel/store.ts'
import { registrarSnapshot, snapshotsDaExecucao, configuracaoDaTarefa } from '../../motor/euclides/snapshot-execucao.ts'
import { tarefa } from '../../motor/api/operacoes.ts'
import type { PreviaRecuperacao, PacoteRecuperacao } from '../../motor/api/recuperacao.ts'

const token = 'recuperacao-fixture-sem-credenciais-123456789'
let base = ''
let url = ''
let servidor: Server
let sequencia = 0
const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
async function subir(repos?: string[]): Promise<void> {
  servidor = criarServidorApi(token, { repos })
  await new Promise<void>(resolve => servidor.listen(0, '127.0.0.1', resolve))
  const a = servidor.address()
  assert.ok(a && typeof a !== 'string')
  url = 'http://127.0.0.1:' + a.port
}
async function fechar(): Promise<void> {
  const fim = new Promise<void>(resolve => servidor.close(() => resolve()))
  servidor.closeAllConnections()
  await fim
}
beforeEach(async () => {
  base = mkdtempSync(join(tmpdir(), 'hii-recuperacao-'))
  process.env.HII_CARDS_DIR = join(base, 'motor')
  process.env.HII_REPOS_FILE = join(base, 'repos.json')
  process.env.HII_IA_FILE = join(base, 'ia.json')
  mkdirSync(process.env.HII_CARDS_DIR)
  mkdirSync(join(base, 'panel'))
  writeFileSync(process.env.HII_REPOS_FILE, JSON.stringify([{ name: 'org/app', path: base }]))
  writeFileSync(process.env.HII_IA_FILE, '{}')
  await subir()
})
afterEach(async () => { await fechar(); rmSync(base, { recursive: true, force: true }) })
function pacote(): PacoteRecuperacao {
  const documento = '---\r\nid: 025\r\nrepo: org/app\r\ntitle: recuperar icones\r\nstatus: PAUSED\r\ncost_usd: 1.25\r\nsessao_id: 008\r\n---\r\n\r\nObjetivo original\r\n\r\n## Historico\r\nTeste falhou; preservar trabalho.\r\n'
  writeFileSync(join(base, 'panel', '025-icones.md'), documento)
  return { versao: 1, origem: sha('panel/org/app/025-icones.md'), arquivo: '025-icones.md', repo: 'org/app', documento,
    anexos: [{ nome: 'historico/025.json', conteudo: Buffer.from('{"tentativas":2}').toString('base64'), sha256: sha('{"tentativas":2}') }] }
}
async function post(path: string, body: object, extra: Record<string, string> = {}): Promise<Response> {
  return fetch(url + path, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json',
    'idempotency-key': 'recuperacao-fixture-' + ++sequencia, ...extra }, body: JSON.stringify(body) })
}
test('preview passivo e importacao concorrente preservam origem byte a byte e nao tocam #020', async () => {
  const original020 = '---\nid: 020\nrepo: org/app\ntitle: nao tocar\nstatus: EXECUTING\n---\nCorpo original'
  writeFileSync(join(process.env.HII_CARDS_DIR!, '020-nao-tocar.md'), original020)
  const p = pacote()
  const previa = await post('/v1/recuperacoes/previa', p)
  assert.equal(previa.status, 200, await previa.clone().text())
  const v = await previa.json() as PreviaRecuperacao
  expect(v.estado).toBe('importar')
  expect(allCards()).toHaveLength(1)
  const respostas = await Promise.all([1, 2].map(() => post('/v1/recuperacoes/importar', { pacote: p, hash: v.hash })))
  expect(respostas.map(r => r.status)).toEqual([200, 200])
  const a = await respostas[0]!.json() as PreviaRecuperacao
  const b = await respostas[1]!.json() as PreviaRecuperacao
  expect(a.tarefa).toBe(b.tarefa)
  assert.ok(a.tarefa)
  expect(readCard(a.tarefa)?.fm.status).toBe('PAUSED')
  expect(readCard(a.tarefa)?.fm.cost_usd).toBe('1.25')
  expect(readFileSync(join(base, 'panel', '025-icones.md'), 'utf8')).toBe(p.documento)
  expect(readFileSync(join(process.env.HII_CARDS_DIR!, '020-nao-tocar.md'), 'utf8')).toBe(original020)
  const arquivo = JSON.parse(readFileSync(join(process.env.HII_CARDS_DIR!, 'recuperacao/importacoes', p.origem + '.json'), 'utf8')) as { pacote: PacoteRecuperacao }
  expect(arquivo.pacote).toEqual(p)
  expect(snapshotsDaExecucao(a.tarefa)).toHaveLength(1)
  const retomar = await post('/v1/tarefas/' + a.tarefa + '/acoes', { acao: 'retomar' }, { 'if-match': tarefa(a.tarefa).etag })
  expect(retomar.status).toBe(409)
  expect(readCard(a.tarefa)?.fm.status).toBe('PAUSED')
  await fechar()
  await subir()
  const repetida = await post('/v1/recuperacoes/importar', { pacote: p, hash: v.hash })
  expect((await repetida.json() as PreviaRecuperacao).tarefa).toBe(a.tarefa)
  expect(allCards()).toHaveLength(2)
})
test('preview alterado, anexos corrompidos e campos estranhos nao importam', async () => {
  const p = pacote()
  const v = await (await post('/v1/recuperacoes/previa', p)).json() as PreviaRecuperacao
  expect((await post('/v1/recuperacoes/importar', { pacote: { ...p, documento: p.documento + 'mudou' }, hash: v.hash })).status).toBe(412)
  expect((await post('/v1/recuperacoes/previa', { ...p, anexos: [{ ...p.anexos[0], conteudo: 3 }] })).status).toBe(400)
  expect((await post('/v1/recuperacoes/previa', { ...p, anexos: [{ ...p.anexos[0], nome: '../outro' }] })).status).toBe(400)
  expect((await post('/v1/recuperacoes/previa', { ...p, anexos: [{ ...p.anexos[0], sha256: '0'.repeat(64) }] })).status).toBe(400)
  expect((await post('/v1/recuperacoes/previa', { ...p, comando: 'nao executar' })).status).toBe(400)
  expect(allCards()).toHaveLength(0)
})
test('escopo da credencial e conferido antes de preview e importacao', async () => {
  const p = pacote()
  await fechar()
  await subir(['org/outro'])
  expect((await post('/v1/recuperacoes/previa', p)).status).toBe(403)
  expect((await post('/v1/recuperacoes/importar', { pacote: p, hash: '0'.repeat(64) })).status).toBe(403)
  expect(allCards()).toHaveLength(0)
})
test('restauracao usa revisao, mantem parada e nao altera preferencias globais', async () => {
  const id = createCard({ title: 'Configuracao', repo: 'org/app', status: 'PAUSED' }, 'Objetivo')
  const s = registrarSnapshot(id, 'configuracao original', { implement: { provider: 'ollama', model: 'fixture' } })
  const rota = '/v1/tarefas/' + id + '/restaurar-configuracao'
  expect((await post(rota, { hash: s.hash })).status).toBe(428)
  expect((await post(rota, { hash: s.hash }, { 'if-match': '"obsoleta"' })).status).toBe(412)
  expect((await post(rota, { hash: s.hash }, { 'if-match': tarefa(id).etag })).status).toBe(200)
  expect(configuracaoDaTarefa(id).implement?.model).toBe('fixture')
  expect(readCard(id)?.fm.status).toBe('PAUSED')
  expect(readFileSync(process.env.HII_IA_FILE!, 'utf8')).toBe('{}')
})
test('ID numerico duplicado nao seleciona silenciosamente uma das tarefas', () => {
  for (const nome of ['025-a.md', '025-b.md']) writeFileSync(join(process.env.HII_CARDS_DIR!, nome), '---\nid: 025\nrepo: org/app\ntitle: x\nstatus: PAUSED\n---\nObjetivo')
  expect(() => readCard('025')).toThrow(/ambiguo/)
})

test('crash apos intencao e antes da importacao e reconciliado na mesma chave', async () => {
  const p = pacote()
  const v = await (await post('/v1/recuperacoes/previa', p)).json() as PreviaRecuperacao
  const entrada = { pacote: p, hash: v.hash }
  const chave = 'importacao-interrompida-fixture'
  const dir = join(process.env.HII_CARDS_DIR!, 'ponte', 'pedidos')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, sha(chave) + '.json'), JSON.stringify({ hash: sha(JSON.stringify(['/v1/recuperacoes/importar', entrada])) }))
  const r = await post('/v1/recuperacoes/importar', entrada, { 'idempotency-key': chave })
  expect(r.status).toBe(200)
  const tarefa = (await r.json() as PreviaRecuperacao).tarefa
  expect(tarefa).toBeTruthy()
  expect(allCards()).toHaveLength(1)
  const repetida = await post('/v1/recuperacoes/importar', entrada, { 'idempotency-key': chave })
  expect((await repetida.json() as PreviaRecuperacao).tarefa).toBe(tarefa)
  expect(allCards()).toHaveLength(1)
})
