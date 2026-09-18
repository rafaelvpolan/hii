import { test, beforeEach, afterEach } from '../apoio/runner.ts'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync, readFileSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { criarServidorApi } from '../../motor/api/servidor.ts'
import { clienteHii } from '../../motor/api/cliente.ts'
import { iniciar, atualizar, terminar, recurso, saida, snapshot, eventos, dentro, heartbeat } from '../../motor/observabilidade/registro.ts'
import { Projecao } from '../../motor/observabilidade/projecao.ts'
import { registrarArtefato, lerArtefato } from '../../motor/observabilidade/artefatos.ts'
import { providerFor } from '../../motor/tomada/registro.ts'
import { runProvider } from '../../motor/euclides/tesouro/confianca.ts'
import { allCards } from '../../motor/cordel/store.ts'
import type { Server } from 'node:http'
import type { Snapshot } from '../../motor/observabilidade/contrato.ts'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { lerLog } from '../../motor/api/log.ts'
import { planoOrquestrado } from '../fixtures/plano-orquestrado.ts'
import { salvarPlano } from '../../motor/oswaldo/orquestracao/planos.ts'
import { patchCard } from '../../motor/cordel/store.ts'
import { writeClarify } from '../../motor/agentes/clarice/clarificar.ts'

let raiz = ''
let server: Server
let url = ''
let chamadas = 0
const token = 'observabilidade-fixture-token-1234567890123'
const escopo = { repo: 'org/app', sessao: '', execucao: '' }
beforeEach(async () => {
  raiz = mkdtempSync(join(tmpdir(), 'hii-observar-'))
  process.env.HII_CARDS_DIR = join(raiz, 'cards')
  process.env.HII_REPOS_FILE = join(raiz, 'repos.json')
  process.env.HII_IA_FILE = join(raiz, 'ia.json')
  process.env.HII_RUNNER_PIDFILE = join(raiz, 'runner.pid')
  process.env.HII_SECRET_SENTINELA = 'sentinela-nao-pode-sair-987654321'
  delete process.env.HII_OBSERVABILIDADE
  mkdirSync(join(raiz, 'repo'))
  writeFileSync(process.env.HII_REPOS_FILE, JSON.stringify([{ name: 'org/app', path: join(raiz, 'repo') }]))
  chamadas = 0
  server = criarServidorApi(token, { admin: true, executarConsulta: async (_id, _provider, req) => {
    chamadas++
    assert.equal(req.mode, 'readonly')
    assert.equal(req.useAgents, false)
    return { ok: true, failed: false, timedOut: false, isError: false, text: 'resposta simulada', detail: '', cost: 0, costMeasured: false, usage: { tokens_in: 0, tokens_out: 0, tokens_cache_create: 0, tokens_cache_read: 0 } }
  } })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  url = `http://127.0.0.1:${address.port}`
})
afterEach(async () => {
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
  rmSync(raiz, { recursive: true, force: true })
  delete process.env.HII_SECRET_SENTINELA
})
const headers = { authorization: `Bearer ${token}` }
const get = (path: string) => fetch(url + path, { headers })
const post = (path: string, b: object, key = 'intent-fixture-123', etag = '') => fetch(url + path, { method: 'POST', headers: { ...headers, 'content-type': 'application/json', 'idempotency-key': key, 'if-match': etag }, body: JSON.stringify(b) })

test('escrita reutilizada respeita substituicao externa e leitores nao alteram o diario', () => {
  const id = iniciar(escopo, recurso('fixture', 'harness'))
  const arquivo = join(raiz, 'cards', 'observabilidade', 'estado.json')
  const original = readFileSync(arquivo, 'utf8')
  const substituido = original.replace('"etapa":"fixture"', '"etapa":"externo"')
  assert.notEqual(substituido, original)
  writeFileSync(`${arquivo}.externo`, substituido)
  renameSync(`${arquivo}.externo`, arquivo)
  saida(id, 'stdout', 'apos escrita externa')
  assert.equal(snapshot().atividades.find(a => a.id === id)?.etapa, 'externo')
  const leitura = snapshot().atividades.find(a => a.id === id)
  assert.ok(leitura)
  leitura.etapa = 'mutacao do leitor'
  saida(id, 'stdout', 'nova escrita')
  assert.equal(snapshot().atividades.find(a => a.id === id)?.etapa, 'externo')
})

test('atividades terminais imutaveis, escopos isolados e replay idempotente', async () => {
  const inicial = snapshot()
  const pai = iniciar(escopo, recurso('gateway', 'orchestrator'))
  const id = await dentro(pai, async () => iniciar(escopo, recurso('fixture', 'harness')))
  iniciar({ ...escopo, repo: 'outra/app' }, recurso('outro', 'harness'))
  saida(id, 'assistant', `ola ${process.env.HII_SECRET_SENTINELA}`)
  terminar(id, 'succeeded')
  const fim = snapshot(escopo).atividades.find(a => a.id === id)
  assert.equal(fim?.pai, pai)
  assert.equal(fim?.metricas.custoUsd.valor, null)
  atualizar(id, a => { a.estado = 'running' })
  assert.deepEqual(snapshot(escopo).atividades.find(a => a.id === id), fim)
  const lote = eventos(inicial.cursor, escopo)
  assert.equal(lote.reset, false)
  assert.ok(lote.eventos.every(e => e.atividade.repo === escopo.repo))
  const p = new Projecao()
  p.reconstruir(inicial)
  for (const e of lote.eventos) { p.aplicar(e); p.aplicar(e) }
  assert.equal(p.atividades.get(id)?.saida.length, 1)
  assert.ok(!JSON.stringify(lote).includes(process.env.HII_SECRET_SENTINELA || 'impossivel'))
  const r = await get('/v1/observabilidade/snapshot?repo=org%2Fapp')
  const publico = await r.json() as Snapshot
  assert.equal(publico.versao, 1)
  assert.equal(publico.atividades.length, 2)
  assert.equal((await get('/v1/observabilidade/snapshot?limite=NaN')).status, 400)
})

test('SSE publica saida antes do terminal e dispose encerra assinatura', async () => {
  const cliente = clienteHii(url, token)
  let receber: () => void = () => {}
  const recebeu = new Promise<void>(resolve => { receber = resolve })
  const assinatura = cliente.observar(escopo, p => {
    if ([...p.atividades.values()].some(a => a.saida.some(s => s.texto === 'parcial') && !a.fim)) receber()
  })
  const id = iniciar(escopo, recurso('fixture', 'harness'))
  saida(id, 'assistant', 'parcial')
  await Promise.race([recebeu, new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error('sem saida incremental')), 5000); timer.unref() })])
  assinatura.dispose()
  await assinatura.concluido
  assert.equal(chamadas, 0)
})

test('cursor de outra geracao exige snapshot; estado persistido sobrevive leitura nova', async () => {
  const id = iniciar(escopo, recurso('fixture', 'harness'))
  terminar(id, 'failed')
  const r = await fetch(url + '/v1/observabilidade/eventos', { headers: { ...headers, 'last-event-id': 'outra:0' } })
  assert.equal(r.status, 409)
  assert.equal(snapshot(escopo).atividades.find(a => a.id === id)?.estado, 'failed')
})

test('falha do registro nao repete nem perde resultado do harness', async () => {
  mkdirSync(process.env.HII_CARDS_DIR || '', { recursive: true })
  writeFileSync(join(process.env.HII_CARDS_DIR || '', 'observabilidade'), 'impede diretorio')
  let invocacoes = 0
  const provider = providerFor('verify')
  const executar = { ...provider, capabilities: () => provider.capabilities(), run: async () => {
    invocacoes++
    return { ok: true, failed: false, timedOut: false, isError: false, text: 'resultado pago', detail: '', cost: 0, costMeasured: true, usage: { tokens_in: 1, tokens_out: 2, tokens_cache_create: 0, tokens_cache_read: 0 } }
  } }
  // Conservar metodos do prototipo do harness, sem executar seu CLI.
  Object.setPrototypeOf(executar, provider)
  const r = await runProvider('', executar, { prompt: 'fixture', cwd: raiz, dirs: [raiz], mode: 'readonly', useAgents: false, timeoutMs: 1000 })
  assert.equal(r.text, 'resultado pago')
  assert.equal(invocacoes, 1)
  assert.equal(snapshot().degradado, true)
})

test('ask readonly idempotente nunca cria card executavel', async () => {
  const a = await post('/v1/ask', { repo: 'org/app', pergunta: 'Qual projeto?' })
  assert.equal(a.status, 202)
  const consulta = await a.json() as { id: string }
  assert.equal((await post('/v1/ask', { repo: 'org/app', pergunta: 'Qual projeto?' })).status, 202)
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(chamadas, 1)
  assert.equal(allCards().length, 0)
  const resultado = await (await get(`/v1/consultas/${consulta.id}`)).json() as { estado: string; custoUsd: number | null }
  assert.equal(resultado.estado, 'succeeded')
  assert.equal(resultado.custoUsd, null)
})

test('configuracao exige versao e revisao, conflito nao sobrescreve preferencia', async () => {
  const inicial = await get('/v1/configuracao')
  const body = { versao: 1, papel: 'verify', provider: 'codex', effort: 'high' }
  assert.equal((await post('/v1/configuracao', body, 'sem-revisao-123')).status, 428)
  assert.equal((await post('/v1/configuracao', body, 'configuracao-123', inicial.headers.get('etag') || '')).status, 200)
  assert.equal((await post('/v1/configuracao', { ...body, effort: 'low' }, 'configuracao-456', inicial.headers.get('etag') || '')).status, 412)
})

test('artefato limitado, redigido, com integridade e sem caminho arbitrario ou symlink', async () => {
  const id = registrarArtefato(escopo, 'resultado', 'text/plain', `resultado ${process.env.HII_SECRET_SENTINELA}`)
  assert.ok(id)
  assert.ok(!lerArtefato(id)?.conteudo.includes(process.env.HII_SECRET_SENTINELA || 'impossivel'))
  assert.equal(registrarArtefato(escopo, 'grande', 'text/plain', 'a'.repeat(262145)), null)
  const arquivo = join(process.env.HII_CARDS_DIR || '', 'observabilidade', 'artefatos', `${id}.json`)
  rmSync(arquivo)
  symlinkSync(join(raiz, 'repos.json'), arquivo)
  assert.equal(lerArtefato(id), null)
  assert.equal((await get(`/v1/artefatos/${id}`)).status, 404)
  assert.equal((await get('/v1/artefatos/../../repos.json')).status, 404)
})

test('credencial escopada recusa snapshots, SSE, comandos e artefatos de outro projeto', async () => {
  const restrito = criarServidorApi(token, { repos: ['org/outro'] })
  await new Promise<void>(r => restrito.listen(0, '127.0.0.1', r))
  const address = restrito.address()
  assert.ok(address && typeof address !== 'string')
  const origem = `http://127.0.0.1:${address.port}`
  try {
    for (const path of ['/v1/observabilidade/snapshot?repo=org/app', '/v1/observabilidade/eventos?repo=org/app', '/v1/estado', '/v1/eventos', '/v1/configuracao']) assert.equal((await fetch(origem + path, { headers })).status, 403)
    const id = registrarArtefato(escopo, 'privado', 'text/plain', 'dados do primeiro projeto')
    assert.equal((await fetch(`${origem}/v1/artefatos/${id}`, { headers })).status, 403)
    const r = await fetch(origem + '/v1/sessoes', { method: 'POST', headers: { ...headers, 'content-type': 'application/json', 'idempotency-key': 'escopo-intent-123' }, body: JSON.stringify({ repo: 'org/app', titulo: 'indevida' }) })
    assert.equal(r.status, 403)
    assert.equal(allCards().length, 0)
  } finally { restrito.closeAllConnections(); await new Promise<void>(r => restrito.close(() => r())) }
})

test('processo encerrado deixa tentativa unknown recuperavel, nao conclusao inventada', () => {
  const modulo = pathToFileURL(resolve('motor/observabilidade/registro.ts')).href
  execFileSync(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(modulo)}); m.iniciar(${JSON.stringify(escopo)},m.recurso('processo-filho','harness'));`], { env: process.env })
  const atividade = snapshot(escopo).atividades.find(a => a.recurso.nome === 'processo-filho')
  assert.equal(atividade?.estado, 'unknown')
  assert.equal(atividade?.fim, null)
  assert.equal(chamadas, 0)
})

test('log v1 redige segredo que atravessa a borda de leitura preservando offset', () => {
  const segredo = process.env.HII_SECRET_SENTINELA || ''
  mkdirSync(join(process.env.HII_CARDS_DIR || '', 'runs'), { recursive: true })
  const original = 'a'.repeat(65530) + segredo + '\n'
  writeFileSync(join(process.env.HII_CARDS_DIR || '', 'runs', '123.live.log'), original)
  const a = lerLog('123', 0)
  const b = lerLog('123', a.proximo)
  assert.equal(a.proximo, 65536)
  assert.equal(b.proximo, Buffer.byteLength(original))
  assert.ok(!(a.texto + b.texto).includes(segredo))
  assert.ok(!b.texto.includes(segredo.slice(6)))
})

test('plano exige pausa e revisao; comandos novos nao viram shell remoto', async () => {
  const cliente = clienteHii(url, token)
  const s = (await cliente.novaSessao('org/app', 'fixture', 'plano-sessao-123')).valor
  const e = (await cliente.pedido(s.id, { modo: 'orquestrador', texto: 'Fixture sem IA' }, 'plano-pedido-123')).valor
  const plano = { ...planoOrquestrado(), id: e.id, sessaoId: s.id }
  salvarPlano(plano, 0, 'plano-local-123')
  const ativo = await cliente.tarefa(e.id)
  assert.equal((await post(`/v1/tarefas/${e.id}/plano`, { plano, revisaoEsperada: 1 }, 'plano-ativo-123', ativo.etag)).status, 409)
  patchCard(e.id, { status: 'PAUSED' }, 'fixture')
  const parado = await cliente.tarefa(e.id)
  const novo = { ...plano, objetivo: 'Nova revisao' }
  assert.equal((await post(`/v1/tarefas/${e.id}/plano`, { plano: novo, revisaoEsperada: 1 }, 'plano-revisao-123', parado.etag)).status, 200)
  const atual = await cliente.tarefa(e.id)
  const shell = { ...novo, criterios: [{ ...novo.criterios[0], comando: { binario: 'sh', argumentos: ['-c', 'touch marcador'], diretorio: '.', timeoutMs: 1000 } }] }
  assert.equal((await post(`/v1/tarefas/${e.id}/plano`, { plano: shell, revisaoEsperada: 2 }, 'plano-shell-123', atual.etag)).status, 400)
  assert.equal(chamadas, 0)
})

test('resposta atrasada nao responde a proxima pergunta quando o card mantem o status', async () => {
  const cliente = clienteHii(url, token)
  const s = (await cliente.novaSessao('org/app', 'fixture', 'pergunta-sessao-123')).valor
  const e = (await cliente.pedido(s.id, { modo: 'gateway', texto: 'Fixture sem IA' }, 'pergunta-pedido-123')).valor
  patchCard(e.id, { status: 'CLARIFY' }, 'fixture')
  writeClarify(e.id, [{ q: 'Primeira?', options: ['sim', 'nao'], recommended: 'sim' }, { q: 'Segunda?', options: ['A', 'B'], recommended: 'A' }])
  const p = await cliente.perguntas(e.id)
  assert.ok(p.valor.perguntaId)
  const r = await cliente.responderPergunta(e.id, p.valor.perguntaId, 'sim', 'resposta-primeira-123', p.etag)
  assert.ok(r.valor)
  const segunda = await cliente.perguntas(e.id)
  assert.notEqual(segunda.valor.perguntaId, p.valor.perguntaId)
  const atrasada = await post(`/v1/tarefas/${e.id}/respostas`, { perguntaId: p.valor.perguntaId, texto: 'nao' }, 'resposta-atrasada-123', p.etag)
  assert.equal(atrasada.status, 412)
  assert.equal((await cliente.perguntas(e.id)).valor.perguntaId, segunda.valor.perguntaId)
})

test('reconciliacao reconstroi transicao perdida sem disparar execucao', async () => {
  process.env.HII_OBSERVABILIDADE = '0'
  const cliente = clienteHii(url, token)
  const s = (await cliente.novaSessao('org/app', 'fixture', 'reconciliar-sessao-123')).valor
  const e = (await cliente.pedido(s.id, { modo: 'gateway', texto: 'Nao executar IA' }, 'reconciliar-pedido-123')).valor
  delete process.env.HII_OBSERVABILIDADE
  assert.equal(snapshot({ execucao: e.id }).atividades.length, 0)
  const observado = (await cliente.observarSnapshot({ execucao: e.id })).valor
  assert.ok(observado.atividades.some(a => a.execucao === e.id && a.detalhes.estadoAutoritativo === true))
  const cursor = observado.cursor
  assert.equal((await cliente.observarSnapshot({ execucao: e.id })).valor.cursor, cursor)
  assert.equal(chamadas, 0)
})

test('heartbeat nao mascara ausencia de progresso', async () => {
  const id = iniciar(escopo, recurso('fixture', 'harness'))
  const progresso = snapshot().atividades.find(a => a.id === id)?.atualizado
  await new Promise(r => setTimeout(r, 10))
  heartbeat(id)
  const a = snapshot().atividades.find(a => a.id === id)
  assert.equal(a?.atualizado, progresso)
  assert.notEqual(a?.heartbeat, progresso)
})

test('integridade do artefato corresponde aos bytes entregues apos redacao', async () => {
  const id = registrarArtefato(escopo, 'relatorio', 'application/json', JSON.stringify({ saida: 'token=segredo-de-fixture\nOutra linha', password: 'credencial-fixture' }))
  assert.ok(id)
  const r = await (await get(`/v1/artefatos/${id}`)).json() as { conteudo: string; sha256: string; tamanho: number }
  assert.equal(createHash('sha256').update(r.conteudo).digest('hex'), r.sha256)
  assert.equal(Buffer.byteLength(r.conteudo), r.tamanho)
  assert.doesNotThrow(() => JSON.parse(r.conteudo))
  assert.ok(!r.conteudo.includes('segredo-de-fixture'))
})

test('ask vincula consulta a sessao, preserva idempotencia e recusa projeto incorreto', async () => {
  const { submitSession } = await import('../../motor/mirante/acoes.ts')
  const { lerSessaoHii } = await import('../../motor/euclides/sessoes.ts')
  const sessao = submitSession({ title: 'Chat', repo: 'org/app' })
  const b = { repo: 'org/app', sessao, pergunta: 'Preserve o contrato' }
  const primeira = await post('/v1/ask', b, 'consulta-com-sessao')
  assert.equal(primeira.status, 202)
  const repetida = await post('/v1/ask', b, 'consulta-com-sessao')
  assert.equal(repetida.status, 202)
  assert.deepEqual(await repetida.json(), await primeira.json())
  for (let i = 0; i < 30 && !chamadas; i++) await new Promise(r => setTimeout(r, 10))
  assert.equal(chamadas, 1)
  const s = lerSessaoHii(sessao)!
  assert.equal(s.consultas?.length, 1)
  assert.equal(s.mensagens.filter(m => m.autor === 'humano').length, 1)
  assert.equal(s.execucoes.length, 0)
  const outra = submitSession({ title: 'Outro', repo: 'org/outro' })
  assert.equal((await post('/v1/ask', { ...b, sessao: outra }, 'consulta-fora-do-repo')).status, 403)
  assert.equal(chamadas, 1)
})

test('chamadas simultaneas conservam microtask explicita em vez do campo compartilhado', async () => {
  const { submit } = await import('../../motor/mirante/acoes.ts')
  const id = submit({ title: 'Ramos', repo: 'org/app' })
  patchCard(id, { microtask_atual: 'A', plano_revisao: '3' })
  const provider = providerFor('verify')
  const falso = { ...provider, capabilities: () => provider.capabilities(), run: async () => ({
    ok: true, failed: false, timedOut: false, isError: false, text: 'fixture', detail: '', cost: 0, costMeasured: true,
    usage: { tokens_in: 0, tokens_out: 0, tokens_cache_create: 0, tokens_cache_read: 0 },
  }) }
  Object.setPrototypeOf(falso, provider)
  await Promise.all(['B', 'C'].map(microtask => runProvider(id, falso, {
    microtask, prompt: 'fixture', cwd: raiz, dirs: [raiz], mode: 'readonly', useAgents: false, timeoutMs: 1000,
  })))
  const atividades = snapshot({ execucao: id }).atividades.filter(a => a.recurso.tipo === 'harness')
  assert.deepEqual(atividades.map(a => a.microtask).sort(), ['B', 'C'])
  assert.ok(atividades.every(a => a.planoRevisao === 3))
})
