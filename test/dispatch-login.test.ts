import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handle, newSession } from '../lib/core/session'
import { dispatch } from '../lib/core/dispatch'
import { dispatchIOFalso } from './fixtures/dispatch-io-falso'
import { allCards } from '../motor/cdl/store'

let saida: string[] = []
let dir = ''
let binDir = ''
let pathAntigo = ''

function binarioFalso(nome: string): void {
  const caminho = join(binDir, nome)
  writeFileSync(caminho, '#!/bin/sh\nexit 0\n')
  chmodSync(caminho, 0o755)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hicode-dispatch-login-'))
  mkdirSync(join(dir, 'runs'), { recursive: true })
  process.env.HICODE_CARDS_DIR = dir
  process.env.HICODE_IA_FILE = join(dir, 'ia.json')
  binDir = mkdtempSync(join(tmpdir(), 'hii-bin-login-'))
  pathAntigo = process.env.PATH ?? ''
  process.env.PATH = binDir
  process.env.HICODE_CLAUDE_CONFIG = join(binDir, 'claude.json')
  saida = []
})

afterEach(() => {
  process.env.PATH = pathAntigo
  delete process.env.HICODE_CLAUDE_CONFIG
  delete process.env.HICODE_IA_FILE
})

const io = dispatchIOFalso({ log: (l: string) => { saida.push(l) } })

test('submit e recusado quando a ia nao esta pronta, com motivo claro nos logs', async () => {
  const bloqueado = dispatchIOFalso({
    log: (l: string) => { saida.push(l) },
    iaProntaParaEnviar: () => ({ ok: false, motivo: 'nao da para enviar — a ia "claude" nao esta autenticada: rode /login' }),
  })
  const antes = allCards().length
  const state = newSession('org/app')
  const r = handle('remove o selo beta', state)
  const d = await dispatch(r.effect, r.state, bloqueado)
  expect(allCards().length).toBe(antes)
  expect(saida.join(' ')).toContain('nao da para enviar')
  expect(d.state.seguindo).toBe('')
})

test('submit segue normal quando a ia esta pronta (comportamento padrao do fixture)', async () => {
  const antes = allCards().length
  const state = newSession('org/app')
  const r = handle('remove o selo beta', state)
  const d = await dispatch(r.effect, r.state, io)
  expect(allCards().length).toBe(antes + 1)
  expect(d.state.seguindo).not.toBe('')
})

test('/login sem argumento mira o provedor ativo do papel implement', async () => {
  binarioFalso('claude')
  writeFileSync(join(binDir, 'claude.json'), JSON.stringify({}))
  const state = newSession('org/app')
  const r = handle('/login', state)
  await dispatch(r.effect, r.state, io)
  const texto = saida.join(' ')
  expect(texto).toContain('claude')
  expect(texto).toContain('/login')
})

test('/login <ia> ja autenticada e dentro da cota diz que nao ha nada a fazer', async () => {
  binarioFalso('claude')
  writeFileSync(join(binDir, 'claude.json'), JSON.stringify({ oauthAccount: { userRateLimitTier: 'default_claude_pro' } }))
  const state = newSession('org/app')
  const r = handle('/login claude', state)
  await dispatch(r.effect, r.state, io)
  expect(saida.join(' ')).toContain('ja esta autenticada')
})

test('/login <ia> desconhecida explica o uso em vez de travar', async () => {
  const state = newSession('org/app')
  const r = handle('/login foguete', state)
  await dispatch(r.effect, r.state, io)
  expect(saida.join(' ')).toContain('ia desconhecida')
})

test('/login ollama nao tem passo de login conhecido — nao inventa comando', async () => {
  const state = newSession('org/app')
  const r = handle('/login ollama', state)
  await dispatch(r.effect, r.state, io)
  expect(saida.join(' ')).toContain('nao tem um passo de login conhecido')
})
