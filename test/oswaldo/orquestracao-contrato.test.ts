import { test, expect, beforeEach, afterEach } from '../apoio/runner.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configDoOrquestrador, configurarOrquestrador, modoDaExecucao } from '../../motor/oswaldo/orquestracao/config.ts'
import { contarLinhas, lerDocumentoDePlano, ondasEstritas, validarPlano } from '../../motor/oswaldo/orquestracao/contrato.ts'
import { lerPlano, salvarPlano } from '../../motor/oswaldo/orquestracao/planos.ts'
import { planoOrquestrado } from '../fixtures/plano-orquestrado.ts'

let dir = ''
let anterior: string | undefined
beforeEach(() => {
  anterior = process.env.HII_CARDS_DIR
  dir = mkdtempSync(join(tmpdir(), 'hii-orquestracao-'))
  process.env.HII_CARDS_DIR = dir
})
afterEach(() => {
  if (anterior === undefined) delete process.env.HII_CARDS_DIR
  else process.env.HII_CARDS_DIR = anterior
  rmSync(dir, { recursive: true, force: true })
})

test('gateway e padrao; ativacao passiva e persistente, idempotente e isolada por projeto', () => {
  expect(configDoOrquestrador('org/app').modo).toBe('gateway')
  expect(configurarOrquestrador('org/app', 'passivo', 2).revisao).toBe(1)
  expect(configurarOrquestrador('org/app', 'passivo', 2).revisao).toBe(1)
  expect(configDoOrquestrador('org/app').concorrencia).toBe(2)
  expect(configDoOrquestrador('org/outro').modo).toBe('gateway')
  configurarOrquestrador('org/app', 'gateway')
  expect(modoDaExecucao({ motor_modo: 'passivo' })).toBe('passivo')
  expect(modoDaExecucao({})).toBe('legado')
  expect(() => configurarOrquestrador('org/app', 'passivo', 0)).toThrow()
})

test('grafo valida predecessoras e preserva ondas paralelas', () => {
  expect(ondasEstritas(validarPlano(planoOrquestrado()).microtasks).map(o => o.map(m => m.id))).toEqual([['A'], ['B', 'C'], ['D']])
  const ausente = planoOrquestrado()
  ausente.microtasks[0]!.dependeDe = ['inexistente']
  expect(() => validarPlano(ausente)).toThrow('referencia ausente')
  const ciclo = planoOrquestrado()
  ciclo.microtasks[0]!.dependeDe = ['D']
  expect(() => validarPlano(ciclo)).toThrow('ciclo')
  const duplicado = planoOrquestrado()
  duplicado.microtasks.push(duplicado.microtasks[0]!)
  expect(() => validarPlano(duplicado)).toThrow('IDs duplicados')
})

test('contrato rejeita versao desconhecida, caminhos externos e criterios ausentes', () => {
  expect(() => lerDocumentoDePlano('{"versao":2}')).toThrow('suportada: 1')
  const p = planoOrquestrado()
  p.microtasks[0]!.arquivos = ['../outro/segredo']
  expect(() => validarPlano(p)).toThrow('caminhos relativos')
  p.microtasks[0]!.arquivos = []
  p.microtasks[0]!.criterios = ['inexistente']
  expect(() => validarPlano(p)).toThrow('criterio ausente')
})

test('500 linhas sao aceitas com LF/CRLF; 501 nunca e truncado', () => {
  const json = JSON.stringify(planoOrquestrado())
  const quinhentas = json + '\n'.repeat(500)
  expect(contarLinhas(quinhentas)).toBe(500)
  expect(lerDocumentoDePlano(quinhentas).id).toBe('002')
  expect(lerDocumentoDePlano(quinhentas.replace(/\n/g, '\r\n')).id).toBe('002')
  expect(() => lerDocumentoDePlano(quinhentas + '\n')).toThrow('500 linhas')
})

test('revisao esperada evita perder edicoes e retry de chave conserva historico', () => {
  const p = planoOrquestrado()
  expect(salvarPlano(p, 0, 'primeira').revisao).toBe(1)
  expect(salvarPlano(p, 0, 'primeira').revisao).toBe(1)
  const novo = { ...p, objetivo: 'Nova revisao humana' }
  expect(() => salvarPlano(novo, 0, 'cliente-atrasado')).toThrow('atual 1')
  expect(() => salvarPlano(novo, 1, 'primeira')).toThrow('outro conteudo')
  expect(salvarPlano(novo, 1, 'segunda').revisao).toBe(2)
  expect(lerPlano(p.repo, p.id, 1)?.plano.objetivo).toBe(p.objetivo)
  expect(lerPlano(p.repo, p.id)?.plano.objetivo).toBe(novo.objetivo)
  expect(lerPlano('org/outro', p.id)).toBe(null)
})
