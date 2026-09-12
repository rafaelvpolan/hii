import { test, expect, afterAll } from '../apoio/runner.ts'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AcumuladorDeLinhas, comRaia, gravarChamadaNoLiveLog, linhaDeConclusao } from '../../motor/tomada/harness/live-log.ts'
import { linhasDoLiveLog } from '../../motor/tomada/harness/codex.ts'
import { parseLog } from '../../motor/mirante/atividade.ts'
import { renderExecucao } from '../../motor/mirante/render/execucao.ts'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-live-log-'))
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const STDOUT_DO_CODEX = [
  JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Vou ajustar o menu.' } }),
  JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'npm test' } }),
  JSON.stringify({ type: 'item.completed', item: { type: 'file_change', path: 'src/menu.vue' } }),
  JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } }),
].join('\n')

test('a raia prefixa cada linha nao vazia, e sem raia o texto sai intacto', () => {
  expect(comRaia('a\n\nb', 'lente 2/4')).toBe('[lente 2/4] a\n\n[lente 2/4] b')
  expect(comRaia('a\nb')).toBe('a\nb')
  expect(linhaDeConclusao(0.5)).toBe('— concluido (custo $0.5000) —')
  expect(linhaDeConclusao()).toBe('— concluido —')
})

test('codex: o stdout em JSON vira fala da IA e chamadas de ferramenta no mesmo dialeto do claude', () => {
  expect(linhasDoLiveLog(STDOUT_DO_CODEX)).toEqual([
    'Vou ajustar o menu.',
    '  → Bash({"command":"npm test"})',
    '  → Edit({"file_path":"src/menu.vue"})',
  ])
})

test('PONTA A PONTA: harness sem stream (codex/kimi/ollama) grava cabecalho rotulado, corpo e conclusao, e a tela mostra o bloco como mostra o do claude', () => {
  const caminho = join(BASE, '007.live.log')
  gravarChamadaNoLiveLog({ caminho, rotulo: 'step · rufus', linhas: linhasDoLiveLog(STDOUT_DO_CODEX) })
  const bruto = readFileSync(caminho, 'utf8')
  expect(bruto).toMatch(/^\n— chamada em \d{4}-\d{2}-\d{2}T[\d:]+Z · step · rufus —\n/)
  expect(bruto.trimEnd().endsWith('— concluido —')).toBe(true)
  const tela = renderExecucao(parseLog(bruto), { color: false, largura: 60 })
  expect(tela.some(l => l.includes('▶ IA · step · rufus'))).toBe(true)
  expect(tela).toContain('┃ Vou ajustar o menu.')
  expect(tela).toContain('● Bash(npm test)')
  expect(tela).toContain('● Edit(src/menu.vue)')
  expect(tela[tela.length - 1]?.startsWith('── ■ concluido ──')).toBe(true)
})

test('chamadas concorrentes no MESMO log: cada raia vira seu proprio bloco e o resultado vai para a ferramenta da raia certa', () => {
  const caminho = join(BASE, '008.live.log')
  gravarChamadaNoLiveLog({ caminho, rotulo: 'ideacao · lente 1/2', raia: 'lente 1/2', linhas: ['  → Read({"file_path":"a.md"})', '  ← conteudo de a'] })
  gravarChamadaNoLiveLog({ caminho, rotulo: 'ideacao · lente 2/2', raia: 'lente 2/2', linhas: ['  → Read({"file_path":"b.md"})', '  ← conteudo de b'] })
  const at = parseLog(readFileSync(caminho, 'utf8'))
  const leituras = at.filter(a => a.tipo === 'arquivo')
  expect(leituras.map(a => [a.raia, a.alvo, a.resultado])).toEqual([
    ['lente 1/2', 'a.md', 'conteudo de a'],
    ['lente 2/2', 'b.md', 'conteudo de b'],
  ])
  expect(at.filter(a => a.tipo === 'sessao').map(a => a.raia)).toEqual(['lente 1/2', 'lente 2/2'])
})

test('REGRESSAO stderr fragmentado: a raia so entra em linha COMPLETA — pedaco cortado no meio da palavra nao ganha prefixo', () => {
  const acc = new AcumuladorDeLinhas()
  expect(acc.empurrar('texto par')).toEqual([])
  expect(acc.empurrar('cial\nsegunda linha\nterc')).toEqual(['texto parcial', 'segunda linha'])
  expect(acc.esvaziar()).toEqual(['terc'])
  expect(acc.esvaziar()).toEqual([])
  const gravado = acc.empurrar('a\nb\n').map(l => comRaia(l, 'r')).join('\n')
  expect(gravado).toBe('[r] a\n[r] b')
})
