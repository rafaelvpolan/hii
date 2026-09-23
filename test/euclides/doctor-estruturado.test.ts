import { test, expect, beforeEach, afterEach } from '../apoio/runner.ts'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { medirCheck, configuracaoEfetiva, checkModelos, checkMcp } from '../../motor/euclides/radar/doctor-estruturado.ts'
import { modelFor, modoFor, providerNameFor, providerFor } from '../../motor/tomada/registro.ts'
let dir = ''
let env: NodeJS.ProcessEnv
beforeEach(() => {
  env = { ...process.env }
  dir = mkdtempSync(join(tmpdir(), 'hii doctor com espacos '))
  process.env.HII_IA_FILE = join(dir, 'ia.json')
})
afterEach(() => { process.env = env; rmSync(dir, { recursive: true, force: true }) })
test('origem e valores do doctor coincidem com resolucao usada no despacho', () => {
  process.env.HII_IMPLEMENT_PROVIDER = 'claude'
  writeFileSync(process.env.HII_IA_FILE!, JSON.stringify({ implement: { provider: 'codex', model: 'modelo-configurado', modo: 'untrusted' } }))
  const c = configuracaoEfetiva().find(c => c.papel === 'implement')!
  expect(c.provedor).toBe(providerNameFor('implement'))
  expect(c.modelo).toBe(modelFor('implement'))
  expect(c.modo).toBe(modoFor('implement'))
  expect(c.origemProvedor).toBe(process.env.HII_IA_FILE)
  expect(c.avisos.join(' ')).toContain('normalizado')
  expect(c.modo).not.toBe('untrusted')
})
test('erro de permissao vira sonda desconhecida e nao vaza segredo', () => {
  process.env.TEST_DOCTOR_TOKEN = 'segredo-fixture-12345'
  const c = medirCheck('permissao', 'host', () => { throw new Error('EACCES segredo-fixture-12345') })
  expect(c.estado).toBe('desconhecido')
  expect(c.severidade).toBe('erro')
  expect(c.detalhe).toContain('EACCES')
  expect(c.detalhe).not.toContain('segredo-fixture')
  expect(c.duracaoMs).toBeGreaterThanOrEqual(0)
  expect(Number.isFinite(Date.parse(c.coletadoEm))).toBe(true)
})
test('modelo desconhecido e catalogo indisponivel sao diagnósticos distintos sem inferencia', () => {
  writeFileSync(process.env.HII_IA_FILE!, JSON.stringify(Object.fromEntries(['implement', 'verify', 'gate', 'step'].map(p => [p, { provider: 'codex', model: 'modelo-ausente' }]))))
  const h = providerFor('gate')
  const original = h.modelosDisponiveis
  const run = h.run
  h.run = async () => { throw new Error('doctor nao pode chamar modelo') }
  try {
    h.modelosDisponiveis = () => ['modelo-existente']
    expect(checkModelos().detalhe).toContain('nao consta')
    h.modelosDisponiveis = () => []
    expect(checkModelos().detalhe).toContain('nao verificado')
  } finally { h.modelosDisponiveis = original; h.run = run }
})

test('MCP diferencia conectado, autenticacao ausente e sonda inconclusiva', async () => {
  const conectado = await checkMcp('notion', async () => ({ usavel: true, motivo: '', tools: ['mcp__notion'] }))
  expect(conectado.severidade).toBe('ok')
  expect(conectado.detalhe).toContain('confirmado')
  const auth = await checkMcp('notion', async () => ({ usavel: false, motivo: 'conector existe mas pede autenticacao', tools: [] }))
  expect(auth.severidade).toBe('aviso')
  expect(auth.conserto).toContain('autentique')
  const incerto = await checkMcp('notion', async () => ({ usavel: false, motivo: 'nao consegui listar', tools: [], transitorio: true }))
  expect(incerto.severidade).toBe('aviso')
  expect(incerto.conserto).toContain('Repita a sonda')
})

test('API de diagnostico nao bloqueia status e compartilha sonda concorrente', async () => {
  const { criarServidorApi } = await import('../../motor/api/servidor.ts')
  const { diagnosticoDoMotor } = await import('../../motor/api/diagnostico.ts')
  const token = 'diagnostico-fixture-token-1234567890'
  process.env.HII_CARDS_DIR = join(dir, 'cards')
  process.env.HII_REPOS_FILE = join(dir, 'repos.json')
  process.env.HII_RUNNER_PIDFILE = join(dir, 'daemon.pid')
  writeFileSync(process.env.HII_REPOS_FILE, '[]')
  let liberar!: () => void
  let chamadas = 0
  const trava = new Promise<void>(r => { liberar = r })
  const sonda = diagnosticoDoMotor(async () => { chamadas++; await trava; return { versao: 1, checks: [], inferencia: false } })
  const repetida = diagnosticoDoMotor(async () => { chamadas++; return {} })
  const servidor = criarServidorApi(token, { admin: true })
  await new Promise<void>(resolve => servidor.listen(0, '127.0.0.1', resolve))
  const endereco = servidor.address()
  if (!endereco || typeof endereco === 'string') throw new Error('sem porta')
  const url = 'http://127.0.0.1:' + endereco.port
  try {
    const iniciouHttp = new Promise<void>(resolve => servidor.once('request', () => resolve()))
    const respostaHttp = fetch(url + '/v1/diagnostico', { headers: { authorization: 'Bearer ' + token } })
    await iniciouHttp
    const status = await fetch(url + '/v1/motor/status', { headers: { authorization: 'Bearer ' + token } })
    expect(status.status).toBe(200)
    expect(chamadas).toBe(1)
    liberar()
    expect(await sonda).toEqual(await repetida)
    expect(await (await respostaHttp).json()).toEqual({ versao: 1, checks: [], inferencia: false })
    expect((await fetch(url + '/v1/diagnostico')).status).toBe(401)
  } finally {
    liberar()
    servidor.closeAllConnections()
    await new Promise<void>(resolve => servidor.close(() => resolve()))
  }
})
