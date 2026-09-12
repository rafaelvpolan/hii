import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-url-auto-'))
process.env.HII_CARDS_DIR = join(BASE, 'cards')
mkdirSync(join(BASE, 'cards'), { recursive: true })
const { decisaoDeAprovacaoDeUrl, aprovarUrlPeloMotor } = await import('../../motor/ciclo/crivo/aprovacao-automatica.ts')
const { createCard, readCard } = await import('../../motor/cordel/store.ts')
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

test('url respondendo com inspecao ok ou indisponivel APROVA sozinha; erro, sem resposta ou sem url deixam a decisao com o humano', () => {
  expect(decisaoDeAprovacaoDeUrl({ temUrl: true, respondeu: true, verify: 'ok' }, true)).toMatchObject({ aprova: true })
  expect(decisaoDeAprovacaoDeUrl({ temUrl: true, respondeu: true, verify: 'inconclusivo' }, true)).toMatchObject({ aprova: true })
  expect(decisaoDeAprovacaoDeUrl({ temUrl: true, respondeu: true, verify: 'falhou' }, true)).toMatchObject({ aprova: false })
  expect(decisaoDeAprovacaoDeUrl({ temUrl: true, respondeu: false, verify: 'inconclusivo' }, true)).toMatchObject({ aprova: false })
  expect(decisaoDeAprovacaoDeUrl({ temUrl: false, respondeu: false, verify: 'sem-dev-server' }, true).motivo).toContain('aprovacao da funcionalidade e sua')
})

test('HII_URL_AUTO_OK=off devolve o comportamento antigo: nada e aprovado sem pergunta', () => {
  const d = decisaoDeAprovacaoDeUrl({ temUrl: true, respondeu: true, verify: 'ok' }, false)
  expect(d.aprova).toBe(false)
  expect(d.motivo).toContain('HII_URL_AUTO_OK=off')
})

test('aprovarUrlPeloMotor so age em card que esta em URL, grava URL_OK e deixa no diario que foi o motor, nao o humano', () => {
  const id = createCard({ title: 't', status: 'URL', repo: 'org/app', risk: 'low', url: 'http://localhost:5203' }, '## Objetivo\nx\n')
  expect(aprovarUrlPeloMotor(id, 'url respondeu e a inspecao passou')).toBe(true)
  const c = readCard(id)
  expect(c?.fm.status).toBe('URL_OK')
  expect(c?.body).toContain('URL->URL_OK aprovada pelo motor: url respondeu e a inspecao passou')
  expect(aprovarUrlPeloMotor(id, 'de novo'), 'ja nao esta em URL').toBe(false)
  const outro = createCard({ title: 't', status: 'CORRECTING', repo: 'org/app', risk: 'low' }, '## Objetivo\nx\n')
  expect(aprovarUrlPeloMotor(outro, 'x')).toBe(false)
  expect(readCard(outro)?.fm.status).toBe('CORRECTING')
})
