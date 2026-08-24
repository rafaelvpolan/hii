import { test, expect, beforeEach } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handle, newSession, COMMANDS, canonico } from '../../motor/mir/sessao.ts'
import { linhaPropriedades } from '../../motor/mir/render/rodape.ts'

// O gauntlet SUBSTITUI o criterio escrito: quando ele roda, nenhuma revisao
// automatica le o diff. Enquanto o modo era escolhido por heuristica (pack
// visual + referencia anexada), isso acontecia sem ninguem pedir. O interruptor
// existe para a escolha ser do humano — e para ela ficar VISIVEL na mesma linha
// onde ele ve as ias selecionadas, senao trocamos falha silenciosa por outra.

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hicode-gauntlet-'))
  process.env.HICODE_IA_FILE = join(dir, 'ia.json')
})

const props = {
  provedor: 'claude', modelo: 'opus', effort: 'medium', modo: 'acceptEdits',
  projeto: 'org/app', custoHoje: '2.37', pisoDoGasto: '', divergentes: [],
}

test('/gauntlet e um comando reconhecido e listado no autocompletar', () => {
  expect(COMMANDS).toContain('/gauntlet')
  const r = handle('/gauntlet on', newSession())
  expect(r.effect.kind).toBe('gauntlet')
  expect(r.effect.text).toBe('on')
})

test('/crivo e apelido de /gauntlet', () => {
  expect(canonico('/crivo')).toBe('/gauntlet')
  expect(handle('/crivo off', newSession()).effect.kind).toBe('gauntlet')
})

test('desligado por omissao: arquivo de preferencia limpo nao liga o gauntlet', async () => {
  const { gauntletLigado } = await import('../../motor/tmd/preferencias.ts')
  expect(gauntletLigado()).toBe(false)
})

test('/gauntlet on liga, /gauntlet off desliga, e a leitura seguinte ja ve', async () => {
  const { definirGauntlet } = await import('../../motor/mir/escolher-ia.ts')
  const { gauntletLigado } = await import('../../motor/tmd/preferencias.ts')
  expect(definirGauntlet(['on']).ok).toBe(true)
  expect(gauntletLigado()).toBe(true)
  expect(definirGauntlet(['off']).ok).toBe(true)
  expect(gauntletLigado()).toBe(false)
})

test('/gauntlet toggle alterna a partir do estado real, nao de um padrao', async () => {
  const { definirGauntlet } = await import('../../motor/mir/escolher-ia.ts')
  const { gauntletLigado } = await import('../../motor/tmd/preferencias.ts')
  definirGauntlet(['toggle'])
  expect(gauntletLigado()).toBe(true)
  definirGauntlet(['toggle'])
  expect(gauntletLigado()).toBe(false)
})

test('/gauntlet sem argumento RELATA o estado e nao muda nada', async () => {
  const { definirGauntlet } = await import('../../motor/mir/escolher-ia.ts')
  const { gauntletLigado } = await import('../../motor/tmd/preferencias.ts')
  definirGauntlet(['on'])
  const r = definirGauntlet([])
  expect(r.mensagem).toContain('LIGADO')
  expect(gauntletLigado(), 'consultar o estado nao pode mudar o estado').toBe(true)
})

test('valor invalido nao vira desligado silencioso — recusa e diz o que aceita', async () => {
  const { definirGauntlet } = await import('../../motor/mir/escolher-ia.ts')
  const { gauntletLigado } = await import('../../motor/tmd/preferencias.ts')
  definirGauntlet(['on'])
  const r = definirGauntlet(['talvez'])
  expect(r.ok).toBe(false)
  expect(r.mensagem).toContain('on')
  expect(gauntletLigado(), 'palavra que nao entendi nao pode desligar o modo por conta propria').toBe(true)
})

test('a mensagem de ligar DIZ que o criterio escrito deixa de rodar', async () => {
  const { definirGauntlet } = await import('../../motor/mir/escolher-ia.ts')
  expect(definirGauntlet(['on']).mensagem).toContain('criterio escrito NAO roda')
})

test('ligado, o estado aparece na linha de propriedades junto com as ias', () => {
  const l = linhaPropriedades({ ...props, gauntlet: true })
  expect(l).toContain('gauntlet')
  expect(l, 'tem de sair na MESMA linha das ias selecionadas, nao num painel separado').toContain('claude/opus')
})

test('desligado, nao ocupa espaco na linha — estado padrao nao vira ruido', () => {
  expect(linhaPropriedades({ ...props, gauntlet: false })).not.toContain('gauntlet')
  expect(linhaPropriedades(props)).not.toContain('gauntlet')
})
