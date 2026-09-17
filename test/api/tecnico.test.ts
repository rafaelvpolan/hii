import { test, beforeEach, afterEach } from '../apoio/runner.ts'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { criarServidorApi } from '../../motor/api/servidor.ts'
import { clienteHii } from '../../motor/api/cliente.ts'
import { allCards } from '../../motor/cordel/store.ts'
import { ensureContract } from '../../motor/cordel/bussola/armazenar.ts'
import { lerPlano } from '../../motor/oswaldo/orquestracao/planos.ts'
import { analisarTecnico, serializarTecnico, contarLinhasTecnicas } from '../../motor/oswaldo/orquestracao/tecnico.ts'
import { documentoTecnico } from '../fixtures/documento-tecnico.ts'
let raiz = '', url = ''
let server: Server
const token = 'tecnico-fixture-token-123456789012345'
beforeEach(async () => {
  raiz = mkdtempSync(join(tmpdir(), 'hii-tecnico-'))
  process.env.HII_CARDS_DIR = join(raiz, 'cards')
  process.env.HII_REPOS_FILE = join(raiz, 'repos.json')
  process.env.HII_IA_FILE = join(raiz, 'ia.json')
  process.env.HII_RUNNER_PIDFILE = join(raiz, 'runner.pid')
  process.env.HII_RIGOR_ESTRITO = '0'
  mkdirSync(join(raiz, 'repo'))
  writeFileSync(process.env.HII_REPOS_FILE, JSON.stringify([{ name: 'org/app', path: join(raiz, 'repo') }]))
  server = criarServidorApi(token, { admin: true })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const addr = server.address(); assert.ok(addr && typeof addr !== 'string')
  url = `http://127.0.0.1:${addr.port}`
})
afterEach(async () => {
  server.closeAllConnections()
  await new Promise<void>(r => server.close(() => r()))
  rmSync(raiz, { recursive: true, force: true })
})
test('limite integral 500/501 inclui linhas vazias e aceita CRLF sem truncar', () => {
  const fonte = serializarTecnico(documentoTecnico())
  const limite = fonte + '\n'.repeat(500 - contarLinhasTecnicas(fonte))
  assert.equal(analisarTecnico(limite).linhas, 500)
  assert.deepEqual(analisarTecnico(limite.replace(/\n/g, '\r\n')).erros, [])
  assert.equal(analisarTecnico(limite + '\n').documento, null)
  assert.match(analisarTecnico(limite + '\n').erros[0]!.mensagem, /501/)
})
test('estruturas malformadas e ciclos retornam diagnostico por campo', () => {
  for (const campo of ['criterios', 'microtasks', 'operacao', 'origem', 'dependencias']) {
    for (const valor of [null, {}, [], 1, true, 'invalido']) {
      const entrada = { ...documentoTecnico(), [campo]: valor }
      assert.ok(analisarTecnico(JSON.stringify(entrada)).erros.length || Array.isArray(valor), campo)
    }
  }
  const d = documentoTecnico()
  d.microtasks[0]!.dependeDe = ['implementar']
  assert.ok(analisarTecnico(serializarTecnico(d)).erros.some(e => e.mensagem.includes('Ciclo')))
})
test('despacho fixa documento e comando local; retry nao duplica execucao', async () => {
  writeFileSync(join(raiz, 'repo/package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }))
  ensureContract(join(raiz, 'repo'), new Date().toISOString())
  const cliente = clienteHii(url, token)
  const sessao = (await cliente.novaSessao('org/app', 'Triagem', 'sessao-tecnica-001')).valor
  const fonte = serializarTecnico(documentoTecnico())
  const r = await cliente.pedido(sessao.id, { modo: 'orquestrador', tecnico: fonte }, 'despacho-tecnico-001')
  const repetida = await cliente.pedido(sessao.id, { modo: 'orquestrador', tecnico: fonte }, 'despacho-tecnico-001')
  assert.equal(repetida.valor.id, r.valor.id)
  const plano = lerPlano('org/app', r.valor.id)
  assert.equal(plano?.plano.origemTecnica?.documento, fonte)
  assert.equal(plano?.plano.produtoId, 'triagem')
  assert.ok(plano?.plano.criterios[0]?.comando)
  assert.equal(allCards().filter(c => c.tecnico_id).length, 1)
})
test('entrada invalida, dependencia, escopo e verificador ausente nao criam execucao', async () => {
  const cliente = clienteHii(url, token)
  const sessao = (await cliente.novaSessao('org/app', 'Triagem', 'sessao-tecnica-002')).valor
  const antes = allCards().length
  const agenteInvalido = documentoTecnico(); agenteInvalido.microtasks[0]!.agente = 'inexistente'
  const entradas = [agenteInvalido, documentoTecnico(), { ...documentoTecnico(), repo: 'outro/app' },
    { ...documentoTecnico(), dependencias: ['anterior'] }, { ...documentoTecnico(), criterios: [] }]
  for (const [i, d] of entradas.entries()) {
    await assert.rejects(() => cliente.pedido(sessao.id, { modo: 'orquestrador', tecnico: serializarTecnico(d) }, `recusa-tecnica-${i}`))
    assert.equal(allCards().length, antes)
  }
})
