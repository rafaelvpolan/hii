import { test, expect } from '../apoio/runner.ts'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, cardsDir, reposFile } from '../../motor/cordel/alicerce/config.ts'

const SUFIXO_SEM_CACHE = 'forced'

function configReavaliada(): Promise<typeof import('../../motor/cordel/alicerce/config.ts')> {
  // A extensao `.ts` fica ANTES da query: sem ela o node nao resolve o modulo
  // (`ERR_MODULE_NOT_FOUND`), enquanto o bun resolve — e a query e o que fura o
  // cache de modulo para reavaliar a config com o ambiente novo.
  return import(`../../motor/cordel/alicerce/config.ts?${SUFIXO_SEM_CACHE}`)
}

test('ROOT aponta para a raiz DESTE repo — serve ao motor e ao painel', () => {
  const marcadores = ['runner.ts', 'cards', join('config', 'repos.json'), join('bin', 'repl.ts')]
  expect(marcadores.some(m => existsSync(join(ROOT, m))), `nenhum marcador de raiz em ${ROOT}`).toBe(true)
  expect(existsSync(join(ROOT, 'package.json'))).toBe(true)
})

test('REGRESSAO sem override, cardsDir e reposFile ficam dentro do ROOT resolvido', () => {
  const cards = process.env.HICODE_CARDS_DIR
  const repos = process.env.HICODE_REPOS_FILE
  delete process.env.HICODE_CARDS_DIR
  delete process.env.HICODE_REPOS_FILE
  try {
    expect(cardsDir().startsWith(ROOT)).toBe(true)
    expect(reposFile().startsWith(ROOT)).toBe(true)
  } finally {
    if (cards !== undefined) process.env.HICODE_CARDS_DIR = cards
    if (repos !== undefined) process.env.HICODE_REPOS_FILE = repos
  }
})

test('com override, cardsDir sai do ROOT — e isso e o esperado', () => {
  const prev = process.env.HICODE_CARDS_DIR
  process.env.HICODE_CARDS_DIR = '/tmp/cards-de-teste'
  expect(cardsDir()).toBe('/tmp/cards-de-teste')
  if (prev === undefined) delete process.env.HICODE_CARDS_DIR
  else process.env.HICODE_CARDS_DIR = prev
})

test('HICODE_ROOT tem precedencia sobre a deteccao', async () => {
  const prev = process.env.HICODE_ROOT
  process.env.HICODE_ROOT = '/tmp/raiz-forcada'
  const fresh = await configReavaliada()
  expect(fresh.ROOT).toBe('/tmp/raiz-forcada')
  if (prev === undefined) delete process.env.HICODE_ROOT
  else process.env.HICODE_ROOT = prev
})

test('listRepos devolve vazio quando o registro nao existe — sem lancar', async () => {
  const prev = process.env.HICODE_REPOS_FILE
  process.env.HICODE_REPOS_FILE = '/tmp/hicode-repos-inexistente.json'
  const { listRepos, repoRegistered } = await import('../../motor/cordel/store.ts')
  expect(listRepos()).toEqual([])
  expect(repoRegistered('owner/x')).toBe(false)
  if (prev === undefined) delete process.env.HICODE_REPOS_FILE
  else process.env.HICODE_REPOS_FILE = prev
})

test('repoRegistered distingue registrado de nao registrado', async () => {
  const { writeFileSync, mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const dir = mkdtempSync(join(tmpdir(), 'hicode-repos-'))
  const f = join(dir, 'repos.json')
  writeFileSync(f, JSON.stringify([{ name: 'owner/alvo', path: '/tmp/alvo', branch: 'main' }]))
  const prev = process.env.HICODE_REPOS_FILE
  process.env.HICODE_REPOS_FILE = f
  const { listRepos, repoRegistered } = await import('../../motor/cordel/store.ts')
  expect(listRepos().length).toBe(1)
  expect(repoRegistered('owner/alvo')).toBe(true)
  expect(repoRegistered('owner/outro')).toBe(false)
  if (prev === undefined) delete process.env.HICODE_REPOS_FILE
  else process.env.HICODE_REPOS_FILE = prev
})

test('knobs da URL de preview leem env, com os defaults de antes da parametrizacao', async () => {
  const nomes = ['HICODE_URL_WAIT_S', 'HICODE_URL_PROBE_INTERVAL_MS', 'HICODE_URL_PROBE_TIMEOUT_MS', 'HICODE_URL_INSPECT_TIMEOUT_MS', 'HICODE_URL_FREEPORT_SETTLE_MS']
  const guardados = nomes.map(n => process.env[n])
  // A query vem de variavel, nao de literal: literal estatico o tsc tenta
  // resolver na hora do typecheck e quebra (TS2307); interpolacao ele deixa
  // passar, e node/bun avaliam em runtime — mesmo truque de configReavaliada.
  const configCom = (marca: string): Promise<typeof import('../../motor/cordel/alicerce/config.ts')> =>
    import(`../../motor/cordel/alicerce/config.ts?${marca}`)
  try {
    // Defaults documentados: mudar aqui muda o comportamento do motor — visivel na revisao.
    for (const n of nomes) delete process.env[n]
    let fresh = await configCom('padrao-url')
    expect(fresh.URL_WAIT_S).toBe(30)
    expect(fresh.URL_PROBE_INTERVAL_MS).toBe(1000)
    expect(fresh.URL_PROBE_TIMEOUT_MS).toBe(5000)
    expect(fresh.URL_INSPECT_TIMEOUT_MS).toBe(60000)
    expect(fresh.URL_FREEPORT_SETTLE_MS).toBe(400)

    process.env.HICODE_URL_WAIT_S = '5'
    process.env.HICODE_URL_PROBE_INTERVAL_MS = '250'
    process.env.HICODE_URL_PROBE_TIMEOUT_MS = '1500'
    process.env.HICODE_URL_INSPECT_TIMEOUT_MS = '20000'
    process.env.HICODE_URL_FREEPORT_SETTLE_MS = '100'
    fresh = await configCom('override-url')
    expect(fresh.URL_WAIT_S).toBe(5)
    expect(fresh.URL_PROBE_INTERVAL_MS).toBe(250)
    expect(fresh.URL_PROBE_TIMEOUT_MS).toBe(1500)
    expect(fresh.URL_INSPECT_TIMEOUT_MS).toBe(20000)
    expect(fresh.URL_FREEPORT_SETTLE_MS).toBe(100)

    // Valor invalido cai no default com aviso (numeroDeEnv), nunca em NaN.
    process.env.HICODE_URL_WAIT_S = 'rapido'
    fresh = await configCom('invalido-url')
    expect(fresh.URL_WAIT_S).toBe(30)
  } finally {
    nomes.forEach((n, i) => {
      if (guardados[i] === undefined) delete process.env[n]
      else process.env[n] = guardados[i]
    })
  }
})

test('esperarPorPid usa o orcamento parametrizado como default — o botao chega no laco de URL', async () => {
  delete process.env.HICODE_URL_WAIT_S
  const { esperarPorPid } = await import('../../motor/ciclo/reprise/url-ajuste.ts')
  // pid 0 nunca sonda a rede: a funcao devolve false na hora. O teste trava a
  // LIGACAO do knob (default = URL_WAIT_S) sem esperar 30s de verdade.
  expect(await esperarPorPid(59999)(0)).toBe(false)
})
