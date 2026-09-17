import { test, beforeEach, afterEach } from '../apoio/runner.ts'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import { criarServidorApi } from '../../motor/api/servidor.ts'
import { clienteHii } from '../../motor/api/cliente.ts'
import { execFileSync } from 'node:child_process'
import { coletarEvidencias, arquivoDeEvidencias } from '../../motor/oswaldo/orquestracao/evidencias.ts'
import { allCards, patchCard } from '../../motor/cordel/store.ts'
import { ensureContract } from '../../motor/cordel/bussola/armazenar.ts'
import { lerPlano, salvarPlano } from '../../motor/oswaldo/orquestracao/planos.ts'
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

test('avaliacao usa a revisao fixada e confere evidencia no Git sem executar verificadores', async () => {
  const repo = join(raiz, 'repo')
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.stdout.write(\'criterio verificado\')"' } }))
  execFileSync('git', ['init', '-b', 'main'], { cwd: repo, stdio: 'ignore' })
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'add', 'package.json'], { cwd: repo })
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture'], { cwd: repo, stdio: 'ignore' })
  ensureContract(repo, new Date().toISOString())
  const cliente = clienteHii(url, token)
  const sessao = (await cliente.novaSessao('org/app', 'Triagem', 'sessao-avaliacao-001')).valor
  const pedido = (await cliente.pedido(sessao.id, { modo: 'orquestrador', tecnico: serializarTecnico(documentoTecnico()) }, 'pedido-avaliacao-001')).valor
  const plano = lerPlano('org/app', pedido.id)!
  patchCard(pedido.id, { worktree: repo })
  assert.equal((await cliente.avaliacao(pedido.id)).valor.atualidade, 'ausente')
  const prova = await coletarEvidencias(plano.plano, plano.revisao, repo)
  assert.equal(prova.aprovado, true)
  const arquivo = arquivoDeEvidencias(pedido.id, plano.revisao)
  const antes = readFileSync(arquivo, 'utf8')
  const atual = (await cliente.avaliacao(pedido.id)).valor
  assert.equal(atual.criteriosAprovados, true)
  assert.equal(atual.criterios[0]?.estado, 'aprovado')
  assert.equal(readFileSync(arquivo, 'utf8'), antes, 'GET nao reexecuta nem regrava evidencia')
  salvarPlano({ ...plano.plano, objetivo: 'Outra proposta ainda nao fixada no card' }, plano.revisao, 'proposta-avaliacao-002')
  assert.equal((await cliente.avaliacao(pedido.id)).valor.plano?.revisao, 1)
  writeFileSync(join(repo, 'novo.ts'), 'mudanca posterior')
  const velha = (await cliente.avaliacao(pedido.id)).valor
  assert.equal(velha.atualidade, 'desatualizada')
  assert.equal(velha.criteriosAprovados, false)
  assert.equal(velha.criterios[0]?.estado, 'inconclusivo')
  assert.equal(velha.criterios[0]?.resultadoRegistrado, 'aprovado')
  rmSync(join(repo, 'novo.ts'))
  writeFileSync(arquivo, JSON.stringify({ ...prova, evidencias: [] }))
  assert.equal((await cliente.avaliacao(pedido.id)).valor.atualidade, 'inconsistente')
  writeFileSync(arquivo, antes)
  patchCard(pedido.id, { worktree: join(raiz, 'ausente') })
  assert.equal((await cliente.avaliacao(pedido.id)).valor.atualidade, 'indisponivel')
})

test('terminal de gateway nao comprova criterio e credencial restrita nao le outro projeto', async () => {
  const cliente = clienteHii(url, token)
  const sessao = (await cliente.novaSessao('org/app', 'Consulta', 'sessao-gateway-001')).valor
  const pedido = (await cliente.pedido(sessao.id, { modo: 'gateway', texto: 'Consultar fixture' }, 'pedido-gateway-001')).valor
  patchCard(pedido.id, { status: 'COMPLETED' })
  assert.equal((await cliente.avaliacao(pedido.id)).valor.criteriosAprovados, false)
  const restrito = criarServidorApi(token, { repos: ['outra/app'] })
  await new Promise<void>(r => restrito.listen(0, '127.0.0.1', r))
  try {
    const endereco = restrito.address(); assert.ok(endereco && typeof endereco !== 'string')
    const r = await fetch(`http://127.0.0.1:${endereco.port}/v1/tarefas/${pedido.id}/avaliacao`, { headers: { authorization: `Bearer ${token}` } })
    assert.equal(r.status, 403)
  } finally {
    restrito.closeAllConnections()
    await new Promise<void>(r => restrito.close(() => r()))
  }
})

test('dependencia exige entrega da revisao; retry e concorrencia nao duplicam execucao', async () => {
  const { certificarEntrega } = await import('../../motor/oswaldo/orquestracao/entrega.ts')
  const repo = join(raiz, 'repo')
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }))
  execFileSync('git', ['init', '-q'], { cwd: repo })
  execFileSync('git', ['add', '.'], { cwd: repo })
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'], { cwd: repo })
  ensureContract(repo, new Date().toISOString())
  // O contrato criado tambem pertence ao commit comprovado.
  execFileSync('git', ['add', '.'], { cwd: repo })
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'contrato'], { cwd: repo })
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()
  const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repo, encoding: 'utf8' }).trim()
  const cliente = clienteHii(url, token)
  const sessao = (await cliente.novaSessao('org/app', 'Dependencias', 'sessao-dependencias-001')).valor
  const fonte = serializarTecnico(documentoTecnico())
  const anterior = (await cliente.pedido(sessao.id, { modo: 'orquestrador', tecnico: fonte }, 'predecessora-001')).valor
  const plano = lerPlano('org/app', anterior.id)!
  const sucessor = { ...documentoTecnico(), id: 'tecnico-sucessor', produtoId: 'sucessor', dependencias: ['triagem'] }
  const refs = [{ produto: 'triagem', execucao: anterior.id, tecnicoHash: plano.plano.origemTecnica!.sha256 }]
  const pedido = { modo: 'orquestrador' as const, tecnico: serializarTecnico(sucessor), dependencias: refs }
  const quantidade = allCards().length
  await assert.rejects(() => cliente.pedido(sessao.id, pedido, 'dependente-retry-001'), /409/)
  assert.equal(allCards().length, quantidade)
  patchCard(anterior.id, { worktree: repo, pushed_sha: head })
  await coletarEvidencias(plano.plano, 1, repo)
  const pr = 'https://github.com/org/app/pull/7'
  const digest = await certificarEntrega(anterior.id, repo, head, pr)
  patchCard(anterior.id, { entrega_evidencia: digest, pr_url: pr, status: 'PR_OPEN' })
  patchCard(anterior.id, { status: 'MERGED' })
  const bin = join(raiz, 'bin'); mkdirSync(bin)
  const resposta = join(raiz, 'remoto.json')
  const remoto = { url: pr, state: 'MERGED', headRefOid: head, mergeCommit: { oid: head }, tree }
  writeFileSync(resposta, JSON.stringify(remoto))
  writeFileSync(join(bin, 'gh'), '#!/usr/bin/env node\nvoid (async()=>{ const fs = await import("node:fs"); const p=JSON.parse(fs.readFileSync(' + JSON.stringify(resposta) + ',"utf8")); console.log(JSON.stringify(process.argv[2]==="pr" ? p : {sha:p.mergeCommit.oid,tree:{sha:p.tree}})); })();\n', { mode: 0o755 })
  const path = process.env.PATH
  process.env.PATH = bin + ':' + path
  try {
    for (const errado of [
      { ...pedido, dependencias: [] },
      { ...pedido, dependencias: [{ ...refs[0]!, tecnicoHash: 'b'.repeat(64) }] },
      { ...pedido, dependencias: [{ ...refs[0]!, produto: 'outra' }] },
      { ...pedido, tecnico: serializarTecnico({ ...sucessor, origem: { ...sucessor.origem, revisao: 2 } }) },
    ]) await assert.rejects(() => cliente.pedido(sessao.id, errado, 'invalido-' + Math.random().toString(16).slice(2)), /409/)
    assert.equal(allCards().length, quantidade)
    const [a, b] = await Promise.all([cliente.pedido(sessao.id, pedido, 'dependente-retry-001'), cliente.pedido(sessao.id, pedido, 'dependente-retry-001')])
    assert.equal(a.valor.id, b.valor.id)
    assert.equal(allCards().length, quantidade + 1)
    assert.equal(lerPlano('org/app', a.valor.id)?.plano.dependenciasProduto?.[0]?.merge, head)
    writeFileSync(resposta, JSON.stringify({ ...remoto, headRefOid: 'b'.repeat(40) }))
    assert.equal((await cliente.pedido(sessao.id, pedido, 'dependente-retry-001')).valor.id, a.valor.id, 'replay confirmado nao reconsulta precondicoes')
    await assert.rejects(() => cliente.pedido(sessao.id, pedido, 'novo-dependente-002'), /409/)
    assert.equal(allCards().length, quantidade + 1)
  } finally { process.env.PATH = path }
})

test('precondicao alterada nao fixa recusa na chave; efeito confirmado nao refaz preparo', async () => {
  const { umaVezPreparada, resposta } = await import('../../motor/api/idempotencia.ts')
  const { ErroApi } = await import('../../motor/api/contrato.ts')
  let mudou = true, efeitos = 0, preparos = 0
  const preparar = async () => { preparos++; return 'prova' }
  const executar = () => { efeitos++; return resposta(201, { execucao: 'fixture' }) }
  const conferir = () => { if (mudou) throw new ErroApi(409, 'mudou', 'dependencia mudou') }
  await assert.rejects(() => umaVezPreparada('preparo-dependencia-001', 'pedido', preparar, executar, conferir))
  assert.equal(efeitos, 0)
  mudou = false
  const [a, b] = await Promise.all([umaVezPreparada('preparo-dependencia-001', 'pedido', preparar, executar, conferir), umaVezPreparada('preparo-dependencia-001', 'pedido', preparar, executar, conferir)])
  assert.equal(a.corpo, b.corpo)
  assert.equal(efeitos, 1)
  const antes = preparos
  mudou = true
  assert.equal((await umaVezPreparada('preparo-dependencia-001', 'pedido', preparar, executar, conferir)).status, 201)
  assert.equal(preparos, antes)
})
