import { test, expect, beforeEach, afterEach } from '../apoio/runner.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { criarSessaoHii, lerSessaoHii, registrarMensagem, vincularExecucao, iniciarSubsessao, concluirSubsessao, fecharSessaoHii, contextoDaSessao } from '../../motor/euclides/sessoes.ts'

let dir = ''
let anterior: string | undefined
beforeEach(() => {
  anterior = process.env.HII_CARDS_DIR
  dir = mkdtempSync(join(tmpdir(), 'hii-sessoes-'))
  process.env.HII_CARDS_DIR = dir
})
afterEach(() => {
  if (anterior === undefined) delete process.env.HII_CARDS_DIR
  else process.env.HII_CARDS_DIR = anterior
  rmSync(dir, { recursive: true, force: true })
})

test('sessao duravel recebe varias execucoes e subsessoes de IAs diferentes', () => {
  criarSessaoHii('001', 'org/app', 'Conversa')
  vincularExecucao('001', '002', 'gateway')
  registrarMensagem('001', { autor: 'humano', texto: 'Preserve o contrato da API', execucao: '002', provedor: '', modelo: '' }, 'pedido-1')
  const primeira = iniciarSubsessao('001', '002', 'claude', 'modelo-a', 'implement')
  concluirSubsessao('001', primeira, false)
  const segunda = iniciarSubsessao('001', '002', 'codex', 'modelo-b', 'implement')
  expect(() => fecharSessaoHii('001')).toThrow('em andamento')
  concluirSubsessao('001', segunda, true)
  vincularExecucao('001', '003', 'passivo')
  const lida = lerSessaoHii('001')!
  expect(lida.estado).toBe('aberta')
  expect(lida.execucoes.map(e => e.id)).toEqual(['002', '003'])
  expect(lida.subsessoes.map(s => s.provedor)).toEqual(['claude', 'codex'])
  expect(lida.subsessoes.every(s => s.nativa === null)).toBe(true)
  expect(contextoDaSessao('001')).toContain('Preserve o contrato da API')
  expect(fecharSessaoHii('001').estado).toBe('fechada')
  expect(() => vincularExecucao('001', '004', 'gateway')).toThrow('fechada')
})

test('sessao rejeita reutilizacao entre projetos e sinaliza contexto nao incluido', () => {
  criarSessaoHii('001', 'org/app', 'Conversa')
  expect(() => criarSessaoHii('001', 'org/outro', 'Outro')).toThrow('outro projeto')
  registrarMensagem('001', { autor: 'humano', texto: 'x'.repeat(1000), execucao: '', provedor: '', modelo: '' })
  expect(contextoDaSessao('001', 50)).toContain('1 mensagens anteriores preservadas')
  expect(lerSessaoHii('001')?.mensagens[0]?.texto.length).toBe(1000)
})
