import { test, beforeEach, afterEach, expect } from '../apoio/runner.ts'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { request } from 'node:http'
import { execFileSync } from 'node:child_process'
import { criarServidorApi } from '../../motor/api/servidor.ts'
import { clienteHii, ErroMotorHttp } from '../../motor/api/cliente.ts'
import { readCard, patchCard, allCards } from '../../motor/cordel/store.ts'
import { registrarTrocaDeIaNoLiveLog } from '../../motor/tomada/rota-log.ts'
import { publicarEvento, lerEventos } from '../../motor/euclides/ponte-eventos.ts'
import { iniciarSubsessao, concluirSubsessao } from '../../motor/euclides/sessoes.ts'
import { umaVez } from '../../motor/api/idempotencia.ts'
import { comRevisao, RevisaoAlterada } from '../../motor/cordel/revisao.ts'
import { agir, tarefa } from '../../motor/api/operacoes.ts'
import { salvarPlano } from '../../motor/oswaldo/orquestracao/planos.ts'
import { planoOrquestrado } from '../fixtures/plano-orquestrado.ts'

const token = 'teste-http-isolado-sem-credenciais-123456789'
let base = ''
let url = ''
let servidor: Server
let cliente: ReturnType<typeof clienteHii>
let numero = 0
const chave = (): string => `pedido-teste-${++numero}`

async function subir(): Promise<void> {
  servidor = criarServidorApi(token)
  await new Promise<void>(resolve => servidor.listen(0, '127.0.0.1', resolve))
  const endereco = servidor.address()
  assert.ok(endereco && typeof endereco !== 'string')
  url = `http://127.0.0.1:${endereco.port}`
  cliente = clienteHii(url, token)
}
async function fechar(): Promise<void> {
  const fim = new Promise<void>(resolve => servidor.close(() => resolve()))
  servidor.closeAllConnections()
  await fim
}
beforeEach(async () => {
  base = mkdtempSync(join(tmpdir(), 'hii-api-'))
  process.env.HII_CARDS_DIR = join(base, 'cards')
  process.env.HII_REPOS_FILE = join(base, 'repos.json')
  process.env.HII_RUNNER_PIDFILE = join(base, 'runner.pid')
  process.env.HII_RIGOR_ESTRITO = '0'
  mkdirSync(join(base, 'projeto'))
  writeFileSync(process.env.HII_REPOS_FILE, JSON.stringify([{ name: 'org/app', path: join(base, 'projeto') }]))
  await subir()
})
afterEach(async () => { await fechar(); rmSync(base, { recursive: true, force: true }) })

async function post(path: string, body: object, extras: Record<string, string> = {}): Promise<Response> {
  return fetch(url + path, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': chave(), ...extras }, body: JSON.stringify(body) })
}
async function nova(): Promise<string> { return (await cliente.novaSessao('org/app', 'Session de teste', chave())).valor.id }
async function execucao(): Promise<string> { return (await cliente.pedido(await nova(), { modo: 'gateway', texto: 'Teste sem executar IA' }, chave())).valor.id }

test('HTTP exige token forte e recusa autenticacao/origem sem expor estado', async () => {
  expect(() => criarServidorApi('curto')).toThrow()
  expect((await fetch(url + '/v1/estado')).status).toBe(401)
  expect((await fetch(url + '/v1/estado', { headers: { authorization: `Bearer ${token}`, origin: 'https://outro.local' } })).status).toBe(403)
  expect(allCards()).toEqual([])
})

test('handshake informa versao, estados e eventos reais; OpenAPI e servido', async () => {
  const c = (await cliente.capacidades()).valor
  expect(c.protocolo).toBe('hii-http')
  expect(c.versao).toBe(1)
  expect(c.statuses).toContain('COMPLETED')
  expect(c.statuses).toContain('CONFIRM')
  expect(c.eventos).toContain('ia_trocada')
  const api = await fetch(url + '/v1/openapi.json', { headers: { authorization: `Bearer ${token}` } })
  const schema = await api.json() as { openapi: string; paths: Record<string, object> }
  expect(schema.openapi).toBe('3.1.1')
  expect(Object.keys(schema.paths)).toContain('/v1/sessoes/{id}/pedidos')
})

test('concorrencia e reinicio nao duplicam a session com a mesma chave', async () => {
  const k = chave()
  const [a, b] = await Promise.all([cliente.novaSessao('org/app', 'Uma', k), cliente.novaSessao('org/app', 'Uma', k)])
  expect(a.valor.id).toBe(b.valor.id)
  await fechar()
  await subir()
  expect((await cliente.novaSessao('org/app', 'Uma', k)).valor.id).toBe(a.valor.id)
  expect(allCards()).toHaveLength(1)
  await assert.rejects(cliente.novaSessao('org/app', 'Outra', k), e => e instanceof ErroMotorHttp && e.status === 409)
})

test('projeto ausente e campos extras nao criam estado', async () => {
  expect((await post('/v1/sessoes', { repo: 'ausente', titulo: 'x' })).status).toBe(404)
  expect((await post('/v1/sessoes', { repo: 'org/app', titulo: 'x', shell: 'ls' })).status).toBe(400)
  expect((await post('/v1/sessoes', { repo: 'org/app', titulo: 'x' }, { 'idempotency-key': '' })).status).toBe(400)
  expect(allCards()).toHaveLength(0)
})

test('gateway e orquestrador encadeiam na mesma session e preservam spec', async () => {
  const s = await nova()
  const k = chave()
  const pedido = { modo: 'gateway' as const, texto: 'Primeiro pedido' }
  const a = (await cliente.pedido(s, pedido, k)).valor
  expect((await cliente.pedido(s, pedido, k)).valor.id).toBe(a.id)
  const b = (await cliente.pedido(s, { modo: 'orquestrador', spec: { nome: 'tarefa.spec', conteudo: '# Tarefa\n## Requisitos\nPreserve isto' } }, chave())).valor
  expect(a.status).toBe('EXECUTING')
  expect(readCard(a.id)?.fm.motor_modo).toBe('gateway')
  expect(readCard(b.id)?.fm.motor_modo).toBe('passivo')
  expect(readCard(b.id)?.body).toContain('> ## Requisitos')
  const conversa = (await cliente.sessao(s)).valor
  expect(conversa.execucoes.map(e => e.id)).toEqual([a.id, b.id])
  expect(conversa.mensagens).toHaveLength(2)
  expect((await cliente.estado('org/app')).valor.conversas[0]?.id).toBe(s)
  expect(readdirSync(join(base, 'projeto'))).toHaveLength(0)
})

test('spec remoto nao le caminhos e inputs invalidos nao criam execucao', async () => {
  const s = await nova()
  for (const body of [
    { modo: 'orquestrador', spec: { nome: '../privado.spec', conteudo: 'x' } },
    { modo: 'orquestrador', spec: { nome: 'x.spec', conteudo: '' } },
    { modo: 'orquestrador', spec: { nome: 'x.spec', conteudo: '\0' } },
    { modo: 'orquestrador', texto: 'x', spec: { nome: 'x.spec', conteudo: 'y' } },
    { modo: 'gateway', spec: { nome: 'x.spec', conteudo: 'y' } },
    { modo: 'off', texto: 'x' },
  ]) expect((await post(`/v1/sessoes/${s}/pedidos`, body)).status).toBe(400)
  expect(allCards()).toHaveLength(1)
})

test('JSON invalido, arrays, tipo incorreto e tamanho excessivo sao recusados', async () => {
  for (const [body, tipo, status] of [['{', 'application/json', 400], ['[]', 'application/json', 400], ['{}', 'text/plain', 415], [JSON.stringify({ texto: 'x'.repeat(2100000) }), 'application/json', 413]] as const) {
    const r = await fetch(url + '/v1/sessoes', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': tipo }, body })
    expect(r.status).toBe(status)
  }
  expect(allCards()).toHaveLength(0)
})

test('If-Match impede acao atrasada e parar/retomar reutilizam a tarefa', async () => {
  const id = await execucao()
  expect((await post(`/v1/tarefas/${id}/acoes`, { acao: 'parar' })).status).toBe(428)
  const antigo = (await cliente.tarefa(id)).etag
  patchCard(id, { campo_teste: 'mudou' })
  expect((await post(`/v1/tarefas/${id}/acoes`, { acao: 'parar' }, { 'if-match': antigo })).status).toBe(412)
  const atual = await cliente.tarefa(id)
  const k = chave()
  await cliente.agir(id, 'parar', 'pedido humano', k, atual.etag)
  await cliente.agir(id, 'parar', 'pedido humano', k, atual.etag)
  expect(readCard(id)?.fm.status).toBe('HALTED')
  const parada = await cliente.tarefa(id)
  await cliente.agir(id, 'retomar', '', chave(), parada.etag)
  expect(readCard(id)?.fm.status).toBe('EXECUTING')
  expect(allCards()).toHaveLength(2)
})

test('revisao e conferida dentro do lock de escrita', async () => {
  const id = await execucao()
  const antes = tarefa(id).etag
  patchCard(id, { outro: 'ator concorrente' })
  expect(() => comRevisao(id, antes, () => patchCard(id, { status: 'COMPLETED' }))).toThrow(RevisaoAlterada)
  expect(readCard(id)?.fm.status).toBe('EXECUTING')
})

test('fechamento bloqueia trabalho pendente e session fechada nao aceita pedidos', async () => {
  const id = await execucao()
  const s = readCard(id)?.fm.sessao_id ?? ''
  let consulta = await cliente.sessao(s)
  await assert.rejects(cliente.fechar(s, chave(), consulta.etag), e => e instanceof ErroMotorHttp && e.status === 409)
  patchCard(id, { status: 'COMPLETED' })
  consulta = await cliente.sessao(s)
  expect((await cliente.fechar(s, chave(), consulta.etag)).valor.estado).toBe('fechada')
  await assert.rejects(cliente.pedido(s, { modo: 'gateway', texto: 'x' }, chave()), e => e instanceof ErroMotorHttp && e.status === 409)
})

test('API preserva subsessoes com modelos e provedores diferentes', async () => {
  const id = await execucao()
  const s = readCard(id)?.fm.sessao_id ?? ''
  const a = iniciarSubsessao(s, id, 'claude', 'modelo-a', 'implement')
  concluirSubsessao(s, a, false)
  const b = iniciarSubsessao(s, id, 'codex', 'modelo-b', 'implement')
  concluirSubsessao(s, b, true, 'thread-de-teste')
  const c = (await cliente.sessao(s)).valor
  expect(c.subsessoes.map(p => p.provedor)).toEqual(['claude', 'codex'])
  expect(c.subsessoes[1]?.nativa).toBe('thread-de-teste')
})

test('SSE real reenvia falha, troca e conclusao na ordem apos reconexao', async () => {
  const id = await execucao()
  const cursor = (await cliente.estado()).valor.cursor
  registrarTrocaDeIaNoLiveLog({ id, de: 'claude', para: 'codex', papel: 'implement', falha: 'cota esgotada', motivo: 'teste' })
  patchCard(id, { status: 'COMPLETED' })
  const signal = AbortSignal.timeout(5000)
  const r = await cliente.eventos(cursor, signal)
  expect(r.headers.get('content-type')).toContain('text/event-stream')
  const reader = r.body!.getReader()
  let texto = ''
  try {
    while (!texto.includes('event: fim')) texto += new TextDecoder().decode((await reader.read()).value)
  } finally { await reader.cancel() }
  expect(texto).toContain('event: ia_falhou')
  expect(texto).toContain('event: ia_trocada')
  expect(texto.indexOf('event: ia_falhou') < texto.indexOf('event: ia_trocada')).toBe(true)
  expect(texto).toContain('mudando automaticamente para codex')
  expect(texto).toContain('COMPLETED')
  const eventos = lerEventos(cursor).eventos
  const ultimaFalha = eventos.find(e => e.tipo === 'ia_falhou')!
  expect(lerEventos(ultimaFalha.id).eventos.some(e => e.id === ultimaFalha.id)).toBe(false)
})

test('CONFIRM gera pausa e confirmacao usa a acao do motor', async () => {
  const id = await execucao()
  const cursor = lerEventos().cursor
  patchCard(id, { status: 'CONFIRM' })
  expect(lerEventos(cursor).eventos.some(e => e.tipo === 'pausa' && e.dados.status === 'CONFIRM')).toBe(true)
  const t = await cliente.tarefa(id)
  await cliente.agir(id, 'confirmar-fecho', '', chave(), t.etag)
  expect(readCard(id)?.fm.status).toBe('URL_OK')
  expect(readCard(id)?.fm.resume_from).toBeTruthy()
})

test('cursor desconhecido e expirado exigem ressincronizacao', async () => {
  const cursor = lerEventos().cursor
  for (let i = 0; i < 1001; i++) publicarEvento('tarefa_atualizada', '001', '', { status: 'EXECUTING' })
  expect(lerEventos(cursor).reset).toBe(true)
  await assert.rejects(cliente.eventos(cursor), e => e instanceof ErroMotorHttp && e.status === 409)
  await assert.rejects(cliente.eventos('outro:1'), e => e instanceof ErroMotorHttp && e.status === 409)
  expect(lerEventos(lerEventos().cursor).eventos).toHaveLength(0)
}, 20000)

test('log tem cursor de bytes, limite, preserva UTF-8 e detecta truncamento', async () => {
  const id = await execucao()
  mkdirSync(join(base, 'cards', 'runs'), { recursive: true })
  const arquivo = join(base, 'cards', 'runs', `${id}.live.log`)
  const esperado = 'x'.repeat(65535) + '\u00e1 fim'
  writeFileSync(arquivo, esperado)
  const a = (await cliente.log(id)).valor
  const b = (await cliente.log(id, a.proximo)).valor
  expect(a.texto + b.texto).toBe(esperado)
  writeFileSync(arquivo, 'novo')
  expect((await cliente.log(id, b.proximo)).valor.reset).toBe(true)
  await assert.rejects(cliente.log(id, -1), e => e instanceof ErroMotorHttp && e.status === 400)
})

test('interrupcao apos efeito nao repete a mutacao automaticamente', () => {
  let efeitos = 0
  expect(() => umaVez('pedido-interrompido', 'payload', () => { efeitos++; throw new Error('crash simulado') })).toThrow()
  expect(() => umaVez('pedido-interrompido', 'payload', () => { efeitos++; throw new Error('nao deveria executar') })).toThrow('reconcilie')
  expect(efeitos).toBe(1)
})

test('acoes desconhecidas, session como tarefa e rotas invalidas sao recusadas', async () => {
  const s = await nova()
  expect((await post(`/v1/tarefas/${s}/acoes`, { acao: 'parar' }, { 'if-match': tarefa(s).etag })).status).toBe(409)
  const id = await execucao()
  expect((await post(`/v1/tarefas/${id}/acoes`, { acao: 'merge' }, { 'if-match': tarefa(id).etag })).status).toBe(400)
  expect((await post('/v1/sessoes/001/acoes', { acao: 'parar' })).status).toBe(404)
  expect(() => agir(id, { acao: 'retomar' }, tarefa(id).etag)).toThrow('nao esta parada')
})

test('SSE acompanha alteracao feita por outro processo e retoma apos reinicio', async () => {
  const id = await execucao()
  const cursor = lerEventos().cursor
  const publicar = new URL('../../motor/euclides/ponte-eventos.ts', import.meta.url).href
  execFileSync(process.execPath, ['-e', `import(${JSON.stringify(publicar)}).then(m => m.publicarEvento('ia_trocada', '${id}', '001', {para:'codex'}))`], { env: process.env })
  await fechar()
  await subir()
  const r = await cliente.eventos(cursor, AbortSignal.timeout(5000))
  const reader = r.body!.getReader()
  let recebido = ''
  try {
    while (!recebido.includes('event: ia_trocada')) recebido += new TextDecoder().decode((await reader.read()).value)
    patchCard(id, { status: 'COMPLETED' })
    while (!recebido.includes('event: fim')) recebido += new TextDecoder().decode((await reader.read()).value)
  } finally { await reader.cancel() }
  expect(recebido).toContain('COMPLETED')
})

test('corpo chunked tambem respeita limite, sem criar dados', async () => {
  const status = await new Promise<number>((resolve, reject) => {
    const req = request(url + '/v1/sessoes', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } }, res => {
      res.resume()
      res.once('end', () => resolve(res.statusCode ?? 0))
    })
    req.once('error', reject)
    req.write('{"texto":"')
    req.write('x'.repeat(2100000))
    req.end('"}')
  })
  expect(status).toBe(413)
  expect(allCards()).toHaveLength(0)
})

test('plano e evidencias sao consultaveis sem executar verificadores', async () => {
  const id = await execucao()
  expect((await cliente.plano(id)).valor.plano).toBe(null)
  const plano = { ...planoOrquestrado(), id, repo: 'org/app' }
  salvarPlano(plano, 0, 'primeira')
  const r = (await cliente.plano(id)).valor
  expect(r.plano?.plano.id).toBe(id)
  expect(r.plano?.revisao).toBe(1)
  expect(r.evidencias).toBe(null)
  expect(r.atualidadeVerificada).toBe(false)
})

test('perda do diario cria outra geracao e o novo cursor acompanha eventos', async () => {
  const id = await execucao()
  const antigo = lerEventos().cursor
  rmSync(join(base, 'cards', 'ponte', 'eventos.json'))
  expect(lerEventos(antigo).reset).toBe(true)
  const novo = (await cliente.estado()).valor.cursor
  expect(novo).not.toBe(antigo)
  patchCard(id, { status: 'COMPLETED' })
  expect(lerEventos(novo).eventos.some(e => e.tipo === 'fim')).toBe(true)
})
