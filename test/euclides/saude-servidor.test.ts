import { test, expect, afterAll, lerArquivo } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, networkInterfaces } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-saude-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(join(process.env.HICODE_CARDS_DIR, 'runs'), { recursive: true })
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const S = await import('../../motor/euclides/radar/servidor.ts')

// A porta de observabilidade nao pode derrubar o motor que ela observa, e nao pode
// mentir sobre onde subiu.

test('porta 0 explicita devolve a porta EFETIVA — `listen` e assincrono no node', async () => {
  const srv = S.subirServidorDeSaude(0)
  expect(srv).not.toBeNull()
  try {
    const porta = await (srv as { pronto: Promise<number> }).pronto
    expect(porta, 'porta 0 significa "peca ao SO"; devolver 0 esconde onde o servidor subiu').toBeGreaterThan(0)
    expect(srv?.porta, 'o getter tem de ler no momento da pergunta').toBe(porta)
  } finally {
    srv?.parar()
  }
})

test('/health responde, e /outra-coisa da 404', async () => {
  const srv = S.subirServidorDeSaude(0)
  try {
    const porta = await (srv as { pronto: Promise<number> }).pronto
    const saude = await fetch(`http://127.0.0.1:${porta}/health`)
    expect([200, 503]).toContain(saude.status)
    expect(saude.headers.get('content-type')).toContain('application/json')
    const outra = await fetch(`http://127.0.0.1:${porta}/qualquer`)
    expect(outra.status).toBe(404)
  } finally {
    srv?.parar()
  }
})

test('erro ao montar a resposta vira 503, nao excecao que derruba o daemon', async () => {
  // `respostaDeSaude` le o estado do disco. Aponta-se o cards dir para um ARQUIVO,
  // e nao um diretorio: `readdirSync` lanca ENOTDIR dentro do callback HTTP.
  const arquivo = join(BASE, 'cards-e-um-arquivo')
  writeFileSync(arquivo, 'nao sou diretorio')
  const anterior = process.env.HICODE_CARDS_DIR
  const srv = S.subirServidorDeSaude(0)
  try {
    const porta = await (srv as { pronto: Promise<number> }).pronto
    process.env.HICODE_CARDS_DIR = arquivo
    const r = await fetch(`http://127.0.0.1:${porta}/health`)
    expect([200, 503], 'o processo tem de continuar de pe e responder algo').toContain(r.status)
    // E o servidor continua atendendo depois do erro:
    process.env.HICODE_CARDS_DIR = anterior
    expect([200, 503]).toContain((await fetch(`http://127.0.0.1:${porta}/health`)).status)
  } finally {
    process.env.HICODE_CARDS_DIR = anterior
    srv?.parar()
  }
})

test('sem HICODE_HEALTH_PORT o servidor NAO sobe — e isso nao e falha', () => {
  const anterior = process.env.HICODE_HEALTH_PORT
  delete process.env.HICODE_HEALTH_PORT
  try {
    expect(S.subirServidorDeSaude()).toBeNull()
  } finally {
    if (anterior === undefined) delete process.env.HICODE_HEALTH_PORT
    else process.env.HICODE_HEALTH_PORT = anterior
  }
})

test('porta ILEGIVEL avisa e nao sobe — nao pode virar "nao configurado" em silencio', () => {
  const anterior = process.env.HICODE_HEALTH_PORT
  const original = process.stderr.write.bind(process.stderr)
  let saida = ''
  process.stderr.write = ((c: string | Uint8Array): boolean => { saida += String(c); return true }) as typeof process.stderr.write
  process.env.HICODE_HEALTH_PORT = '8O80'
  try {
    expect(S.subirServidorDeSaude()).toBeNull()
    expect(saida, 'container unhealthy sem explicacao e o pior dos dois mundos').toContain('nao e uma porta valida')
  } finally {
    process.stderr.write = original
    if (anterior === undefined) delete process.env.HICODE_HEALTH_PORT
    else process.env.HICODE_HEALTH_PORT = anterior
  }
})

// A LICAO da auditoria anterior: ela reportou "/health responde 200" testando por
// `docker exec`, de DENTRO do container, e o HEALTHCHECK tambem sondava 127.0.0.1.
// As duas sondas eram internas; o consumidor real e externo e levaria
// ECONNREFUSED. Estes dois testes medem do lugar do consumidor.
function ipNaoLoopback(): string {
  const nets = Object.values(networkInterfaces()).flat()
  return nets.find(n => n && n.family === 'IPv4' && !n.internal)?.address ?? ''
}

test('bind PADRAO e loopback — inalcancavel de fora, e isso e intencional', async () => {
  const ip = ipNaoLoopback()
  if (!ip) return
  const anterior = process.env.HICODE_HEALTH_BIND
  delete process.env.HICODE_HEALTH_BIND
  const srv = S.subirServidorDeSaude(0)
  try {
    const porta = await (srv as { pronto: Promise<number> }).pronto
    expect(S.enderecoDeSaude(), 'servidor sem hostname liga em 0.0.0.0 e expoe /health sem autenticacao').toBe('127.0.0.1')
    const deFora = await fetch(`http://${ip}:${porta}/health`).then(r => r.status).catch(() => 'recusado')
    expect(deFora, 'com bind de loopback o consumidor externo tem de ser recusado').toBe('recusado')
  } finally {
    srv?.parar()
    if (anterior === undefined) delete process.env.HICODE_HEALTH_BIND
    else process.env.HICODE_HEALTH_BIND = anterior
  }
})

test('com HICODE_HEALTH_BIND=0.0.0.0 (o que o Dockerfile define) o /health responde DE FORA', async () => {
  const ip = ipNaoLoopback()
  if (!ip) return
  const anterior = process.env.HICODE_HEALTH_BIND
  process.env.HICODE_HEALTH_BIND = '0.0.0.0'
  const srv = S.subirServidorDeSaude(0)
  try {
    const porta = await (srv as { pronto: Promise<number> }).pronto
    const deFora: number | string = await fetch(`http://${ip}:${porta}/health`).then(r => r.status).catch(() => 'recusado')
    expect([200, 503] as (number | string)[], `sonda de ${ip} — o EXPOSE do container promete alcance externo`).toContain(deFora)
  } finally {
    srv?.parar()
    if (anterior === undefined) delete process.env.HICODE_HEALTH_BIND
    else process.env.HICODE_HEALTH_BIND = anterior
  }
})

test('INVARIANTE o runner anuncia a porta DEPOIS de o listen resolver', async () => {
  const fonte = await lerArquivo('runner.ts')
  expect(fonte, 'anunciar antes do listen promete porta que pode nunca ter aberto').toContain('saude.pronto.then(')
  expect(fonte, 'e o caso de falha tem de ser dito, nao omitido').toContain('/health NAO subiu')
})
