import { test, expect, beforeEach, afterAll } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { podarRegistrosAntigos, ehRegistroPodavel, cardDoLedger } from '../lib/runner/podar-registros'

const DIA_MS = 24 * 60 * 60 * 1000
const criados: string[] = []
let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hicode-poda-'))
  criados.push(dir)
  mkdirSync(join(dir, 'runs'), { recursive: true })
  process.env.HICODE_CARDS_DIR = dir
})

afterAll(() => {
  for (const d of criados) rmSync(d, { recursive: true, force: true })
  delete process.env.HICODE_CARDS_DIR
})

function gravar(nome: string, idadeMs: number): void {
  const caminho = join(dir, 'runs', nome)
  writeFileSync(caminho, '{}\n')
  const s = (Date.now() - idadeMs) / 1000
  utimesSync(caminho, s, s)
}

function restantes(): string[] {
  return readdirSync(join(dir, 'runs')).sort()
}

test('conversa e ledger fora da janela de 7 dias sao podados', () => {
  gravar('conversa-20260101000000-123.json', 8 * DIA_MS)
  gravar('20260101000000-123.ias.jsonl', 8 * DIA_MS)
  const r = podarRegistrosAntigos()
  expect(r.removidos.length).toBe(2)
  expect(restantes()).toEqual([])
})

test('dentro da janela nada e podado', () => {
  gravar('conversa-20260101000000-123.json', 2 * DIA_MS)
  gravar('20260101000000-123.ias.jsonl', 6 * DIA_MS)
  expect(podarRegistrosAntigos().removidos).toEqual([])
  expect(restantes().length).toBe(2)
})

test('REGRESSAO a poda nao encosta no registro de run, que e o historico', () => {
  gravar('001-20260101000000.json', 30 * DIA_MS)
  gravar('conversa-20260101000000-123.json', 30 * DIA_MS)
  const r = podarRegistrosAntigos()
  expect(r.removidos).toEqual(['conversa-20260101000000-123.json'])
  expect(restantes()).toEqual(['001-20260101000000.json'])
})

test('so conversa e ledger sao podaveis — run e outros arquivos nao', () => {
  expect(ehRegistroPodavel('conversa-20260101000000-1.json')).toBe(true)
  expect(ehRegistroPodavel('20260101000000-1.ias.jsonl')).toBe(true)
  expect(ehRegistroPodavel('001-20260101000000.json')).toBe(false)
  expect(ehRegistroPodavel('qualquer.txt')).toBe(false)
})

test('TTL configuravel por env, para o operador apertar sem mexer em codigo', () => {
  process.env.HICODE_REGISTROS_TTL_MS = String(DIA_MS)
  gravar('conversa-20260101000000-9.json', 2 * DIA_MS)
  expect(podarRegistrosAntigos().removidos.length).toBe(1)
  delete process.env.HICODE_REGISTROS_TTL_MS
})

test('REGRESSAO ledger de card VIVO nao e podado, por mais velho que esteja', () => {
  writeFileSync(join(dir, '042-parada.md'),
    '---\nid: "042"\nstatus: HALTED\ntitle: tarefa parada\nrepo: org/app\n---\n## Objetivo\nx\n')
  gravar('042-20260101000000.ias.jsonl', 30 * DIA_MS)
  expect(podarRegistrosAntigos().removidos).toEqual([])
  expect(restantes()).toEqual(['042-20260101000000.ias.jsonl'])
})

test('ledger de card que nao existe mais e podado normalmente', () => {
  gravar('777-20260101000000.ias.jsonl', 30 * DIA_MS)
  expect(podarRegistrosAntigos().removidos).toEqual(['777-20260101000000.ias.jsonl'])
})

test('cardDoLedger extrai o id do card, e conversa nao tem card', () => {
  expect(cardDoLedger('042-20260101000000.ias.jsonl')).toBe('042')
  expect(cardDoLedger('conversa-20260101000000-9.ias.jsonl')).toBe('')
  expect(cardDoLedger('conversa-20260101000000-9.json')).toBe('')
})
