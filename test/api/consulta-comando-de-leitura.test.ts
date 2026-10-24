import { test, expect, afterAll, dormir } from '../apoio/runner.ts'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { runProvider } from '../../motor/euclides/tesouro/confianca.ts'

// Na API, a preparacao do comando de leitura roda DENTRO do setImmediate da
// consulta (a intencao ja esta persistida): bloqueio termina succeeded e falha de
// git/gh termina failed, os dois com a parada como resposta, custo zero e sem
// chamar a IA; comando monta prompt (o mesmo da TUI), cwd e tempo de novo. O
// executar injetado em criarConsulta faz o papel da IA.

const TEMPO_MS = 60_000
const BASE = realpathSync(mkdtempSync(join(tmpdir(), 'hii-consulta-leitura-')))

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, stdio: 'ignore' })
}

function repoComCommit(nome: string, arquivo: string, conteudo: string): string {
  const d = join(BASE, nome)
  mkdirSync(join(d, 'src'), { recursive: true })
  git(d, 'init', '-q')
  writeFileSync(join(d, arquivo), conteudo)
  git(d, 'add', '-A')
  git(d, 'commit', '-qm', 'fixture')
  return d
}

const LINHA_ALTERADA = 'linha-alterada-da-api-4e2'
const ALVO = repoComCommit('alvo', 'src/app.ts', 'export const valor = 1\n')
writeFileSync(join(ALVO, 'src', 'app.ts'), `export const valor = 2 // ${LINHA_ALTERADA}\n`)
const LIMPO = repoComCommit('limpo', 'src/app.ts', 'export const valor = 1\n')
const GRANDE = repoComCommit('grande', 'grande.txt', 'a\n')
writeFileSync(join(GRANDE, 'grande.txt'), Array.from({ length: 500 }, (_, i) => `linha ${i} ${'y'.repeat(90)}`).join('\n') + '\n')
// Repositorio sem commit: e raiz de git, mas `git diff HEAD` falha de verdade.
const SEM_COMMIT = join(BASE, 'sem-commit')
mkdirSync(SEM_COMMIT, { recursive: true })
git(SEM_COMMIT, 'init', '-q')

const ENV_ANTES: Record<string, string | undefined> = {}
function fixar(chave: string, valor: string): void {
  if (!(chave in ENV_ANTES)) ENV_ANTES[chave] = process.env[chave]
  process.env[chave] = valor
}

fixar('HII_CARDS_DIR', join(BASE, 'cards'))
mkdirSync(join(BASE, 'cards'), { recursive: true })
fixar('HII_REPOS_FILE', join(BASE, 'repos.json'))
writeFileSync(join(BASE, 'repos.json'), JSON.stringify([
  { name: 'org/app', path: ALVO },
  { name: 'org/limpo', path: LIMPO },
  { name: 'org/sem-commit', path: SEM_COMMIT },
]))
fixar('HII_RUNNER_PIDFILE', join(BASE, 'runner.pid'))
fixar('HII_CLAUDE_CONFIG', join(BASE, 'claude-config-inexistente.json'))
fixar('HII_CLAUDE_HOME_DIR', join(BASE, 'home-claude'))
fixar('HII_PROJECT_MEMORY', 'off')
fixar('HII_VERIFY_PROVIDER', 'claude')
fixar('HII_IMPLEMENT_PROVIDER', 'claude')
delete process.env.HII_AI_PROVIDER

const { criarConsulta, lerConsulta } = await import('../../motor/api/consulta.ts')
const { prepararComandoDeLeitura } = await import('../../motor/quilombo/cartorio/comando-de-leitura.ts')
const { promptDoComandoDeLeitura } = await import('../../motor/quilombo/cartorio/responder-pergunta.ts')
const { PASTA_DO_CLAUDE } = await import('../../motor/tomada/harness/pasta-do-claude.ts')
const { GATE_TIMEOUT_MIN_MS } = await import('../../motor/cordel/alicerce/config.ts')
const { criarServidorApi } = await import('../../motor/api/servidor.ts')

afterAll(() => {
  for (const [chave, valor] of Object.entries(ENV_ANTES)) {
    if (valor === undefined) delete process.env[chave]
    else process.env[chave] = valor
  }
  rmSync(BASE, { recursive: true, force: true })
})

interface ChamadaDoExecutar {
  prompt: string
  cwd: string
  timeoutMs: number
  mode: string
}

type Consulta = ReturnType<typeof lerConsulta>

function executarFalso(chamadas: ChamadaDoExecutar[]): typeof runProvider {
  return async (_sessao, _provider, req) => {
    chamadas.push({ prompt: req.prompt, cwd: req.cwd, timeoutMs: req.timeoutMs, mode: req.mode })
    return { ok: true, failed: false, timedOut: false, isError: false, text: 'revisao feita', detail: '', cost: 0.02, costMeasured: true, usage: { tokens_in: 1, tokens_out: 1, tokens_cache_create: 0, tokens_cache_read: 0 } }
  }
}

async function consultar(repo: string, pergunta: string, chamadas: ChamadaDoExecutar[]): Promise<Consulta> {
  const r = criarConsulta({ repo, pergunta }, executarFalso(chamadas))
  expect(r.status).toBe(202)
  const { id } = JSON.parse(r.corpo) as { id: string }
  for (let i = 0; i < 2000; i++) {
    const c = lerConsulta(id)
    if (c.estado !== 'running') return c
    await dormir(10)
  }
  throw new Error(`consulta ${id} nao terminou`)
}

function instrucoesDaPasta(nome: string): string {
  const texto = readFileSync(join(PASTA_DO_CLAUDE, 'comandos', `${nome}.md`), 'utf8').replace(/\r/g, '')
  const m = texto.match(/^---\n([\s\S]*?)\n---/)
  return (m ? texto.slice((m.index ?? 0) + m[0].length) : texto).trim()
}

test('consulta-comando-de-leitura: parada termina succeeded sem executar (consulta: parada termina succeeded sem executar)', async () => {
  const preparo = await prepararComandoDeLeitura('/hii-review', LIMPO)
  const parada = preparo?.parada ?? ''
  expect(parada.trim().length).toBeGreaterThan(0)
  expect(preparo?.falhou).toBe(false)

  const chamadas: ChamadaDoExecutar[] = []
  const c = await consultar('org/limpo', '/hii-review', chamadas)
  expect(c.estado).toBe('succeeded')
  expect(c.resposta.trim()).toBe(parada.trim())
  expect(c.custoUsd).toBe(0)
  expect(chamadas).toEqual([])
}, TEMPO_MS)

test('consulta-comando-de-leitura: falha de git termina failed, com o motivo na resposta e sem executar', async () => {
  const preparo = await prepararComandoDeLeitura('/hii-review', SEM_COMMIT)
  const parada = preparo?.parada ?? ''
  expect(parada).toContain('git falhou')
  expect(preparo?.falhou).toBe(true)

  const chamadas: ChamadaDoExecutar[] = []
  const c = await consultar('org/sem-commit', '/hii-review', chamadas)
  expect(c.estado).toBe('failed')
  expect(c.resposta.trim()).toBe(parada.trim())
  expect(c.custoUsd).toBe(0)
  expect(chamadas).toEqual([])
}, TEMPO_MS)

test('consulta-comando-de-leitura: numero de PR invalido tambem para como succeeded, sem executar', async () => {
  const chamadas: ChamadaDoExecutar[] = []
  const c = await consultar('org/app', '/hii-review-pr abc', chamadas)
  expect(c.estado).toBe('succeeded')
  expect(c.resposta.trim().length).toBeGreaterThan(0)
  expect(c.custoUsd).toBe(0)
  expect(chamadas).toEqual([])
}, TEMPO_MS)

test('consulta-comando-de-leitura: com comando, executar recebe as instrucoes e o diff no prompt, roda no alvo e com o tempo do preparo', async () => {
  const preparo = await prepararComandoDeLeitura('/hii-review', ALVO)
  expect(preparo?.parada).toBeUndefined()

  if (!preparo) throw new Error('/hii-review nao foi reconhecido')

  const chamadas: ChamadaDoExecutar[] = []
  const c = await consultar('org/app', '/hii-review', chamadas)
  expect(chamadas).toHaveLength(1)
  const [chamada] = chamadas
  // Mesmo prompt da TUI: uma so montagem, com o retrato do ambiente.
  expect(chamada?.prompt).toBe(promptDoComandoDeLeitura(preparo, '/hii-review', ALVO))
  expect(chamada?.prompt).toContain('AMBIENTE DESTA MAQUINA')
  expect(chamada?.prompt).toContain(instrucoesDaPasta('hii-review'))
  expect(chamada?.prompt).toContain('src/app.ts')
  expect(chamada?.prompt).toContain(LINHA_ALTERADA)
  expect(chamada?.mode).toBe('readonly')
  expect(chamada?.cwd).toBe(ALVO)
  expect(chamada?.timeoutMs).toBe(preparo?.timeoutMs)
  expect(c.estado).toBe('succeeded')
  expect(c.resposta).toBe('revisao feita')
  expect(c.custoUsd).toBe(0.02)
}, TEMPO_MS)

test('consulta-comando-de-leitura: prepararComandoDeLeitura devolve timeoutMs — hii-plan igual ao minimo do gate; hii-review com diff grande maior', async () => {
  const minimo = GATE_TIMEOUT_MIN_MS
  const plano = await prepararComandoDeLeitura('/hii-plan desenhar o caixa', ALVO)
  expect(plano?.timeoutMs).toBe(minimo)
  const revisao = await prepararComandoDeLeitura('/hii-review', GRANDE)
  expect(revisao?.parada).toBeUndefined()
  expect(revisao?.timeoutMs ?? 0).toBeGreaterThan(minimo)

  const chamadas: ChamadaDoExecutar[] = []
  await consultar('org/app', '/hii-plan desenhar o caixa', chamadas)
  expect(chamadas).toHaveLength(1)
  expect(chamadas[0]?.timeoutMs).toBe(minimo)
  expect(chamadas[0]?.prompt).toContain(instrucoesDaPasta('hii-plan'))
}, TEMPO_MS)

test('garantia: pergunta comum na API continua com 120 s, no checkout do projeto e sem instrucoes de comando', async () => {
  const chamadas: ChamadaDoExecutar[] = []
  const c = await consultar('org/app', 'o que faz /hii-review?', chamadas)
  expect(chamadas).toHaveLength(1)
  expect(chamadas[0]?.timeoutMs).toBe(120000)
  expect(chamadas[0]?.cwd).toBe(ALVO)
  expect(chamadas[0]?.prompt).toContain('o que faz /hii-review?')
  expect(chamadas[0]?.prompt).not.toContain(LINHA_ALTERADA)
  expect(c.estado).toBe('succeeded')
}, TEMPO_MS)

test('garantia /v1/recursos com {comando, descricao, origem}: comandos da pasta aparecem sem canal nem instrucoes', async () => {
  const token = 'teste-recursos-isolado-sem-credenciais-123456789'
  const servidor: Server = criarServidorApi(token)
  await new Promise<void>(resolve => servidor.listen(0, '127.0.0.1', resolve))
  try {
    const porta = (servidor.address() as AddressInfo).port
    const r = await fetch(`http://127.0.0.1:${porta}/v1/recursos?repo=org/app`, { headers: { authorization: `Bearer ${token}` } })
    expect(r.status).toBe(200)
    const corpo = await r.json() as { provedor: string; comandos: Record<string, string>[] }
    expect(corpo.provedor).toBe('claude')
    for (const c of corpo.comandos) {
      expect(Object.keys(c).sort().filter(k => !['comando', 'descricao', 'origem'].includes(k)), c.comando).toEqual([])
    }
    const revisao = corpo.comandos.find(c => c.comando === '/hii-review')
    expect(revisao?.origem).toBe('orquestrador')
    expect(Object.keys(revisao ?? {}).sort()).toEqual(['comando', 'descricao', 'origem'])
  } finally {
    const fim = new Promise<void>(resolve => servidor.close(() => resolve()))
    servidor.closeAllConnections()
    await fim
  }
}, TEMPO_MS)
