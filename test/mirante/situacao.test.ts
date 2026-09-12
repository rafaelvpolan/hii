import { test, expect } from '../apoio/runner.ts'
import { renderSituacao } from '../../motor/mirante/render/situacao.ts'
import { visibleLen } from '../../motor/mirante/tui/layout.ts'
import type { Situacao } from '../../motor/mirante/render/situacao.ts'

// A queixa: a area de execucao mostrava o que a IA fazia (Read, Edit, Task) e nada
// do que o MOTOR decidia — perfil, escopo, gate, tentativa N/M do laco de reparo.
// Isso vivia no diario do card, que ninguem abre no meio do trabalho.
const BASE: Situacao = {
  fm: {
    id: '023', status: 'EXECUTING', title: 'cores do podium', steps_profile: 'visual',
    escopo_alvos: 'ui-lab/leaderboard.html', escopo_refs: 'barbeiro-frontend',
    cost_usd: '0.4210', tokens_total: '18400', crivo_modo: 'criterio-escrito',
  },
  eventos: [
    { ts: '', card: '023', evento: 'fase_inicio', fase: 'implement' },
    { ts: '', card: '023', evento: 'repair_attempt', fase: 'implement', detalhe: 'tentativa 2/3: falhou' },
    { ts: '', card: '023', evento: 'gate_verdict', fase: 'implement', detalhe: 'CONDITIONAL' },
  ],
  atividades: [
    { tipo: 'agente', nome: 'limpio', alvo: 'implementar', ts: '' },
    { tipo: 'skill', nome: 'frontend-web/tokens', alvo: '', ts: '' },
    { tipo: 'arquivo', nome: 'Edit', alvo: 'ui-lab/leaderboard.html', ts: '' },
  ],
  tocados: ['ui-lab/leaderboard.html'],
}

test('mostra EXPLICITAMENTE agente, skill, loop de reparo, gate e perfil', () => {
  const t = renderSituacao(BASE, { width: 90 }).join('\n')
  expect(t, 'perfil escolhido pelo motor').toContain('visual')
  expect(t, 'agente que atuou').toContain('limpio')
  expect(t, 'skill que casou').toContain('frontend-web/tokens')
  expect(t, 'o laco de reparo, com a tentativa').toContain('tentativa 2/3')
  expect(t, 'o veredito do gate').toContain('CONDITIONAL')
  expect(t, 'o modo do crivo (harness)').toContain('criterio-escrito')
  expect(t, 'o gasto').toContain('US$0.4210')
})

test('mostra o ESCOPO, que e o que faltava para o incidente nao repetir', () => {
  const t = renderSituacao(BASE, { width: 90 }).join('\n')
  expect(t).toContain('ui-lab/leaderboard.html')
  expect(t).toContain('barbeiro-frontend')
})

test('violacao de escopo aparece em destaque, e alinhada como as outras linhas', () => {
  const linhas = renderSituacao({ ...BASE, fm: { ...BASE.fm, escopo_violado: 'barbeiro-frontend/tokens.css' } }, { width: 90 })
  const viol = linhas.find(l => l.includes('FORA ESCOPO')) ?? ''
  expect(viol).toContain('barbeiro-frontend/tokens.css')
  // Todas as linhas de campo comecam a MESMA coluna: rotulo longo desalinhava a
  // tabela justamente na linha que mais importa.
  const campos = linhas.filter(l => /^ {4}\S/.test(l))
  const colunas = new Set(campos.map(l => l.length - l.replace(/^ +/, '').length))
  expect(colunas.size, 'colunas diferentes = tabela torta').toBe(1)
})

test('campo vazio NAO ocupa linha — tela com campo vazio treina o olho a ignorar', () => {
  const magro = renderSituacao({ fm: { id: '1', status: 'READY' }, eventos: [], atividades: [], tocados: [] }, { width: 80 })
  expect(magro.length, 'so o cabecalho').toBe(1)
  expect(magro[0]).toContain('READY')
})

test('nenhuma linha passa da largura pedida', () => {
  for (const width of [40, 60, 90, 120]) {
    const longo = { ...BASE, fm: { ...BASE.fm, title: 'x'.repeat(200), escopo_refs: 'y/'.repeat(60) } }
    for (const l of renderSituacao(longo, { width })) {
      expect(visibleLen(l), `largura ${width}: ${JSON.stringify(l.slice(0, 30))}`).toBeLessThanOrEqual(width)
    }
  }
})

test('omitir tira o que o cabecalho fixo da tarefa ja mostra', () => {
  const t = renderSituacao(BASE, { width: 90, omitir: ['agentes', 'ultima acao'], cabecalho: false }).join('\n')
  expect(t).not.toContain('limpio')
  expect(t, 'sem cabecalho, o titulo nao se repete').not.toContain('cores do podium')
  expect(t, 'mas o que o motor decidiu continua').toContain('visual')
})

test('o painel mostra o HARNESS atual com trocas, o que esta EM VOO, os candidatos do gauntlet e ha quanto tempo o card espera', () => {
  const agora = Date.parse('2026-09-12T12:00:00Z')
  const t = renderSituacao({
    ...BASE,
    fm: { ...BASE.fm, status: 'HALTED', status_since: '2026-09-12T09:30:00Z', crivo_modo: 'gauntlet' },
    chamadas: [
      { ts: '2026-09-12T10:00:00Z', papel: 'implement', provedor: 'claude', modelo: 'claude-fable-5-1', custoUsd: 1, custoMedido: true, tokens: 1, tokensEntrada: 1, tokensSaida: 0, tokensCache: 0, duracaoS: 1, ok: false, classeDeFalha: 'quota' },
      { ts: '2026-09-12T10:01:00Z', papel: 'implement', provedor: 'kimi', modelo: 'k2', custoUsd: 1, custoMedido: true, tokens: 1, tokensEntrada: 1, tokensSaida: 0, tokensCache: 0, duracaoS: 1, ok: true },
    ],
    emVoo: ['lente 1/4', 'lente 2/4', 'lente 3/4', 'lente 4/4'],
    candidatos: 3,
    agoraMs: agora,
  }, { width: 100 }).join('\n')
  expect(t).toContain('harness     kimi k2 · 1 troca de provedor')
  expect(t).toContain('em voo      4 chamadas: lente 1/4, lente 2/4, lente 3/4, lente 4/4')
  expect(t).toContain('crivo       gauntlet · 3 candidatos cegos')
  expect(t).toContain('parado ha   2h30 em HALTED')
})

test('card em execucao, sem ledger e sem nada em voo, NAO ganha linha vazia de harness, em voo ou parado ha', () => {
  const t = renderSituacao(BASE, { width: 90 }).join('\n')
  expect(t).not.toContain('harness')
  expect(t).not.toContain('em voo')
  expect(t).not.toContain('parado ha')
  expect(t).toContain('crivo       criterio-escrito')
})
