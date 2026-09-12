import { test, expect } from '../apoio/runner.ts'
import { cabecalhoDaChamada, renderEvent, respostaDeIa } from '../../motor/tomada/harness/claude-stream.ts'
import { parseLog } from '../../motor/mirante/atividade.ts'
import { renderExecucao } from '../../motor/mirante/render/execucao.ts'

const RESPOSTA_DO_LIMPIO = '## Summary\n- Changed: menu mobile com overlay fullscreen\n- Validated: vue-tsc limpo, 191 testes\n- Pending: nada'

function logDeUmaChamada(): string {
  const emVoo = new Map<string, string>()
  const linhas = [
    cabecalhoDaChamada('2026-09-10T01:15:26Z', 'implement'),
    renderEvent({ type: 'system', subtype: 'init', model: 'claude-fable-5-1' }, emVoo),
    renderEvent({ type: 'assistant', message: { content: [{ type: 'text', text: 'Vou delegar o menu ao limpio.' }, { type: 'tool_use', id: 't1', name: 'Task', input: { subagent_type: 'limpio', description: 'menu mobile' } }] } }, emVoo),
    renderEvent({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: RESPOSTA_DO_LIMPIO }] }] } }, emVoo),
    renderEvent({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npx vitest run' } }] } }, emVoo),
    renderEvent({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'x'.repeat(300) }] } }, emVoo),
    renderEvent({ type: 'assistant', message: { content: [{ type: 'text', text: '**limpio** implementou o menu; eu corrigi o overlay.' }] } }, emVoo),
    renderEvent({ type: 'result', total_cost_usd: 2.4524 }, emVoo),
  ]
  return linhas.join('\n')
}

test('a linha de abertura carrega o rotulo do papel/agente, e sem rotulo fica como sempre foi', () => {
  expect(cabecalhoDaChamada('2026-09-10T01:15:26Z', 'implement')).toBe('— chamada em 2026-09-10T01:15:26Z · implement —')
  expect(cabecalhoDaChamada('2026-09-10T01:15:26Z')).toBe('— chamada em 2026-09-10T01:15:26Z —')
})

test('resultado de Task (subagente) sai INTEIRO, linha a linha, como fala de IA; ferramenta comum continua curta', () => {
  const emVoo = new Map<string, string>()
  renderEvent({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a', name: 'Task', input: {} }, { type: 'tool_use', id: 'b', name: 'Read', input: {} }] } }, emVoo)
  const task = renderEvent({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: RESPOSTA_DO_LIMPIO }] } }, emVoo)
  expect(task.split('\n')).toEqual(['  ← Task respondeu:', ...RESPOSTA_DO_LIMPIO.split('\n')])
  const read = renderEvent({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'b', content: 'y'.repeat(500) }] } }, emVoo)
  expect(read.startsWith('  ← ')).toBe(true)
  expect(read.length).toBeLessThan(120)
  expect(emVoo.size).toBe(0)
})

test('resposta de IA gigante e cortada no teto, sem estourar o log', () => {
  const linhas = respostaDeIa('z'.repeat(10_000), 'Task')
  expect(linhas[0]).toBe('  ← Task respondeu:')
  expect(linhas.join('\n').length).toBeLessThan(4_100)
  expect(linhas[linhas.length - 1]?.endsWith('…')).toBe(true)
})

test('PONTA A PONTA: o que o escritor grava vira, na tela da tarefa, separador de bloco + fala literal da IA + resposta do subagente', () => {
  const at = parseLog(logDeUmaChamada())
  const tela = renderExecucao(at, { color: false, largura: 60 })
  expect(tela[0]).toBe('')
  expect(tela[1]?.startsWith('── ▶ IA · implement · claude-fable-5-1 · 01:15:26 ──')).toBe(true)
  expect(tela).toContain('┃ Vou delegar o menu ao limpio.')
  expect(tela).toContain('● Task(limpio — menu mobile)')
  expect(tela).toContain('  ⎿ Task respondeu:')
  expect(tela).toContain('┃ ## Summary')
  expect(tela).toContain('┃ - Changed: menu mobile com overlay fullscreen')
  expect(tela).toContain('┃ **limpio** implementou o menu; eu corrigi o overlay.')
  expect(tela[tela.length - 1]?.startsWith('── ■ concluido · US$2.4524 ──')).toBe(true)
  expect(tela.some(l => l.includes('x'.repeat(200)))).toBe(false)
})
