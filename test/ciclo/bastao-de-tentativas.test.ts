// O bastao escrito do revezamento de IAs (R: de 09/09): cada tentativa gravada em
// runs/<id>.attempts.json diz QUAL provedor a escreveu, e o texto reinjetado no
// prompt da tentativa seguinte carrega essa autoria — porque quem recebe o bastao
// pode ser OUTRA IA, e "nao repita os mesmos erros" so faz sentido se quem le sabe
// de quem veio o erro. Tentativa antiga (gravada antes do campo existir) continua
// legivel e aparece sem autoria, nunca com autoria inventada.

import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-bastao-'))
process.env.HII_CARDS_DIR = join(BASE, 'cards')
mkdirSync(process.env.HII_CARDS_DIR, { recursive: true })

const { appendAttempt, readAttempts } = await import('../../motor/ciclo/reprise/tentativas.ts')
const { attemptHistory } = await import('../../motor/ciclo/corrigir.ts')

afterAll(() => rmSync(BASE, { recursive: true, force: true }))

test('a tentativa gravada carrega o provedor, e a leitura devolve de volta', () => {
  appendAttempt('070', 'correcao', 'ajuste o rodape', 'mexi no rodape mas quebrou o menu', 'claude')

  const gravadas = readAttempts('070')
  expect(gravadas).toHaveLength(1)
  expect(gravadas[0]?.provedor).toBe('claude')
})

test('o texto reinjetado DIZ de quem veio cada bastao — e avisa que quem le pode ser outra IA', () => {
  appendAttempt('071', 'correcao', 'ajuste o rodape', 'mexi no rodape mas quebrou o menu', 'claude')
  appendAttempt('071', 'reprovacao', 'refaca o menu', 'refeito com outro layout', 'codex')

  const texto = attemptHistory('071')
  expect(texto).toContain('[correcao por claude]')
  expect(texto).toContain('[reprovacao por codex]')
  expect(texto).toContain('voce pode ser OUTRA')
})

test('tentativa SEM provedor (gravada antes do campo existir) aparece sem autoria — nunca com autoria inventada', () => {
  appendAttempt('072', 'correcao', 'pedido antigo', 'resposta antiga')

  const gravadas = readAttempts('072')
  expect(gravadas[0]?.provedor).toBeUndefined()
  const texto = attemptHistory('072')
  expect(texto).toContain('[correcao]')
  expect(texto).not.toContain('por undefined')
})

test('card sem tentativa nenhuma reinjeta NADA — historico vazio nao vira cabecalho sem itens', () => {
  expect(attemptHistory('073')).toBe('')
})
