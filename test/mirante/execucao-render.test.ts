import { test, expect } from '../apoio/runner.ts'
import { parseLog, classificar, ehProsa } from '../../motor/mirante/atividade.ts'
import { renderExecucao, linhasDaAtividade, chamadaDe } from '../../motor/mirante/render/execucao.ts'
import { renderFrame } from '../../motor/mirante/tui/layout.ts'
import { CANTO } from '../../motor/mirante/tui/paleta.ts'

const semCor = { color: false }

test('resultado da ferramenta (←) vira linha ⎿ ligada a chamada anterior', () => {
  const at = parseLog('  → Bash({"command":"npm test"})\n  ← 1208 pass 0 fail')
  expect(at).toHaveLength(1)
  expect(at[0]?.resultado).toBe('1208 pass 0 fail')
  expect(renderExecucao(at, semCor)).toEqual(['● Bash(npm test)', '  ⎿ 1208 pass 0 fail'])
})

test('resultado NAO cola em prosa nem em marco', () => {
  const at = parseLog('— sessao iniciada (opus) —\n  ← lixo')
  expect(at[0]?.resultado).toBeUndefined()
})

test('MCP com hifen no metodo e parseado — o regex antigo parava no hifen', () => {
  const at = parseLog('  → mcp__claude_ai_Notion__notion-search({"query":"FASE 3"})')
  expect(at[0]?.tipo).toBe('mcp')
  expect(at[0]?.alvo).toBe('notion-search')
  expect(renderExecucao(at, semCor)[0]).toBe('● notion-search(FASE 3)')
})

test('JSON truncado no meio da string ainda extrai o comando', () => {
  const at = parseLog('  → Bash({"command":"ls /home/rpolan/projects/podium/.hicode-worktrees/cash…)')
  expect(at[0]?.alvo).toContain('ls /home/rpolan/projects')
})

test('barra invertida escapada nao vaza para a tela', () => {
  const at = parseLog('  → Bash({"command":"git check-ignore -v x; echo \\"exit=$?\\""})')
  expect(at[0]?.alvo).not.toContain('\\')
})

test('prosa de varias linhas fica sob um unico bullet', () => {
  const at = parseLog('Nao consegui executar.\nO conector esta bloqueado.')
  expect(at).toHaveLength(1)
  expect(ehProsa(at[0]!)).toBe(true)
  expect(renderExecucao(at, semCor)).toEqual(['┃ Nao consegui executar.', '┃ O conector esta bloqueado.'])
})

test('linha em branco preserva a quebra de paragrafo dentro do bullet', () => {
  const at = parseLog('primeiro paragrafo\n\nsegundo paragrafo')
  expect(renderExecucao(at, semCor)).toEqual(['┃ primeiro paragrafo', '┃ ', '┃ segundo paragrafo'])
})

test('chamada em + sessao iniciada viram UM separador de bloco com modelo e hora, na largura pedida', () => {
  const at = parseLog('— chamada em 2026-08-17T15:19:13Z —\n— sessao iniciada (claude-opus-5[1m]) —')
  expect(at).toHaveLength(1)
  const linhas = renderExecucao(at, { color: false, largura: 60 })
  expect(linhas).toEqual(['', '── ▶ IA · claude-opus-5[1m] · 15:19:13 ─────────────────────'])
  expect(linhas[1]?.length).toBe(60)
})

test('o rotulo do bloco (papel/agente) escrito na linha de chamada entra no separador', () => {
  const at = parseLog('— chamada em 2026-08-17T15:19:13Z · implement —\n— sessao iniciada (claude-fable-5-1) —')
  expect(at[0]?.args).toBe('implement')
  const linha = renderExecucao(at, { color: false, largura: 70 })[1] ?? ''
  expect(linha.startsWith('── ▶ IA · implement · claude-fable-5-1 · 15:19:13 ──')).toBe(true)
  expect(linha.length).toBe(70)
})

test('fim e timeout fecham o bloco com separador proprio; a prosa da IA sai literal, com calha', () => {
  const at = parseLog('— chamada em 2026-08-17T15:19:13Z · gate —\n— sessao iniciada (m) —\n**limpio** implementou o menu.\nSegunda linha, com `codigo`.\n— concluido (custo $2.4524) —')
  const linhas = renderExecucao(at, { color: false, largura: 50 })
  expect(linhas).toEqual([
    '',
    '── ▶ IA · gate · m · 15:19:13 ────────────────────',
    '┃ **limpio** implementou o menu.',
    '┃ Segunda linha, com `codigo`.',
    '── ■ concluido · US$2.4524 ───────────────────────',
  ])
  expect(renderExecucao(parseLog('— TIMEOUT: encerrando a IA —'), { color: false, largura: 50 })[0]).toBe('── ✕ TIMEOUT — a IA foi encerrada ────────────────')
})

test('separador nunca fica menor que a largura nem estoura por rotulo longo', () => {
  const curto = renderExecucao(parseLog('— chamada em 2026-08-17T15:19:13Z —\n— sessao iniciada (' + 'x'.repeat(80) + ') —'), { color: false, largura: 40 })
  expect(curto[1]?.startsWith('── ▶ IA · ')).toBe(true)
  expect(curto[1]?.endsWith('──')).toBe(true)
})

test('falha no resultado ganha cor de erro; sucesso fica dim', () => {
  const erro = linhasDaAtividade({ tipo: 'shell', nome: 'bash', alvo: 'x', ts: '', resultado: 'permission denied' }, { color: true })
  const ok = linhasDaAtividade({ tipo: 'shell', nome: 'bash', alvo: 'x', ts: '', resultado: 'tudo certo' }, { color: true })
  expect(erro[1]).toContain('\x1b[31m')
  expect(ok[1]).not.toContain('\x1b[31m')
})

test('nome da ferramenta capitalizado como no CLI', () => {
  expect(chamadaDe(classificar({ ferramenta: 'Read', entrada: { file_path: '/a/b/c.ts' } }))).toBe('Read(b/c.ts)')
  expect(chamadaDe(classificar({ ferramenta: 'Grep', entrada: { pattern: 'selo' } }))).toBe('Grep(selo)')
})

test('a regiao fixa NAO e comida pelo log que cresce', () => {
  const fixo = ['#023 executando', 'objetivo: criar task', '── processos ──']
  const corpo = Array.from({ length: 300 }, (_, i) => `linha ${i}`)
  const f = renderFrame({
    rows: 20, cols: 80, header: 'hii', fixo, corpo, input: '', cursor: 0,
    dica: 'dica', prompt: '› ', rodape: ['gasto'], legenda: 'projeto',
  })
  const texto = f.lines.join('\n')
  for (const l of fixo) expect(texto).toContain(l)
  expect(texto).toContain('linha 299')
  expect(f.lines.length).toBeLessThanOrEqual(20)
})

test('regiao fixa maior que a caixa cede espaco em vez de sumir com o log', () => {
  const fixo = Array.from({ length: 40 }, (_, i) => `fixo ${i}`)
  const f = renderFrame({
    rows: 14, cols: 80, header: 'hii', fixo, corpo: ['ultima do log'], input: '', cursor: 0,
    dica: '', prompt: '› ', rodape: [], legenda: 'projeto',
  })
  expect(f.lines.length).toBeLessThanOrEqual(14)
  expect(f.lines.join('\n')).toContain('ultima do log')
})

test('REGRESSAO chamadas paralelas: resultado vai para a chamada CERTA, em FIFO', () => {
  const at = parseLog([
    '  → Read({"file_path":"/a/UM.ts"})',
    '  → Read({"file_path":"/b/DOIS.ts"})',
    '  ← conteudo do UM',
    '  ← conteudo do DOIS',
  ].join('\n'))
  expect(at.map(a => a.resultado)).toEqual(['conteudo do UM', 'conteudo do DOIS'])
})

test('resultado sobrando nao vaza para chamada ja resolvida', () => {
  const at = parseLog('  → Read({"file_path":"/a/UM.ts"})\n  ← primeiro\n  ← sobra')
  expect(at[0]?.resultado).toBe('primeiro')
})

test('REGRESSAO: cabecalho pinado NAO pode esconder a confirmacao no rodape do log', () => {
  const painel = [
    '  ── apagar 1 tarefa ──',
    '    #023  url   US$1.47',
    '',
    '  enter confirma · n cancela',
  ]
  const fixo = Array.from({ length: 40 }, (_, i) => `cabecalho ${i}`)
  for (const rows of [10, 14, 18, 24, 30, 50]) {
    const f = renderFrame({
      rows, cols: 80, header: 'hii', fixo, corpo: painel, input: '', cursor: 0,
      dica: 'dica', prompt: '› ', rodape: ['gasto'], legenda: 'projeto · tarefa #023',
    })
    const tela = f.lines.join('\n')
    expect(tela).toContain('enter confirma')
    expect(f.lines.length).toBeLessThanOrEqual(rows)
  }
})

test('regiao pinada cede espaco ao log, nunca o contrario', () => {
  const fixo = Array.from({ length: 100 }, (_, i) => `f${i}`)
  const corpo = Array.from({ length: 100 }, (_, i) => `log ${i}`)
  const f = renderFrame({
    rows: 24, cols: 60, header: 'h', fixo, corpo, input: '', cursor: 0,
    dica: '', prompt: '› ', rodape: [], legenda: 'p',
  })
  const tela = f.lines.join('\n')
  expect(tela).toContain('f0')
  expect(tela).toContain('log 99')
})

test('REGRESSAO: plano de 19 linhas aparece de verdade, mesmo dentro de tarefa', () => {
  const plano = [
    'PLANO · card #023   perfil enxuto', '',
    '    Objetivo   criar task no notion', '    Alvo       org/app', '',
    '── Realizacao ──', '    1. Limpeza        pura', '',
    '    pula Arquitetura, Testes, Seguranca, Review', '',
    '── Execucao ──', '    enter aprova · /ok aprova o url', '', '    Nada foi executado.',
  ]
  const fixo = Array.from({ length: 20 }, (_, i) => `cabecalho ${i}`)
  const f = renderFrame({
    rows: 30, cols: 80, header: 'hii', fixo, corpo: plano, input: '', cursor: 0,
    dica: 'dica', prompt: '› ', rodape: ['gasto'], legenda: 'org/app · #023',
  })
  const tela = f.lines.join('\n')
  expect(tela).toContain('Realizacao')
  expect(tela).toContain('Nada foi executado')
  expect(tela).toContain('cabecalho 0')
  expect(f.lines.length).toBeLessThanOrEqual(30)
})

test('a regiao pinada nunca passa de 40% da caixa', () => {
  const pinado = Array.from({ length: 200 }, (_, i) => `p${i}`)
  for (const rows of [14, 20, 24, 30, 40, 60]) {
    const f = renderFrame({
      rows, cols: 60, header: 'h', fixo: pinado, corpo: ['ultima'], input: '', cursor: 0,
      dica: '', prompt: '› ', rodape: [], legenda: 'p',
    })
    const iAbre = f.lines.findIndex(l => l.includes(CANTO.supEsq))
    const dentro = iAbre - 2
    const pinadas = f.lines.filter(l => /^p\d+/.test(l)).length
    expect(pinadas).toBeGreaterThan(0)
    expect(pinadas).toBeLessThanOrEqual(Math.ceil(dentro * 0.4))
    expect(f.lines.join('\n')).toContain('ultima')
  }
})

// ---- linha do tempo da orquestracao ----
import { linhaDoTempo } from '../../motor/euclides/linha-do-tempo.ts'
import { renderLinhaDoTempo } from '../../motor/mirante/render/execucao.ts'
import type { EventoDoCard } from '../../motor/euclides/eventos.ts'
import type { ChamadaDeIa } from '../../motor/cordel/tipos.ts'

const LOG_DA_ORQUESTRACAO = [
  '— chamada em 2026-09-12T10:00:00Z · implement · vitro —',
  '— sessao iniciada (claude-fable-5-1) —',
  'Vou mexer no menu.',
  '  → Edit({"file_path":"src/menu.vue"})',
  '  ← ok',
  '— concluido (custo $0.4000) —',
  '[lente 1/2] — chamada em 2026-09-12T10:05:00Z · ideacao · lente 1/2 —',
  '[lente 2/2] — chamada em 2026-09-12T10:05:00Z · ideacao · lente 2/2 —',
  '[lente 1/2] ideia A',
  '[lente 2/2] ideia B',
  '[lente 1/2] — concluido (custo $0.0500) —',
  '— chamada em 2026-09-12T10:10:00Z · gate · crivo —',
  '  → Read({"file_path":"src/menu.vue"})',
].join('\n')

function ledger(ts: string, papel: ChamadaDeIa['papel'], provedor: string, custoUsd: number, modelo: string, ok = true): ChamadaDeIa {
  return { ts, papel, provedor, modelo, custoUsd, custoMedido: true, tokens: 1234, tokensEntrada: 1000, tokensSaida: 234, tokensCache: 0, duracaoS: 95, ok, classeDeFalha: ok ? '' : 'quota' }
}

const EVENTOS_DA_ORQUESTRACAO: EventoDoCard[] = [
  { ts: '2026-09-12T09:59:00Z', card: '001', evento: 'fase_inicio', fase: 'implement', detalhe: 'vitro' },
  { ts: '2026-09-12T10:04:30Z', card: '001', evento: 'fase_fim', fase: 'implement', detalhe: 'aprovada' },
  { ts: '2026-09-12T10:04:40Z', card: '001', evento: 'model_tier_selected', chave: 'gate', detalhe: 'tier2_medio (diff pequeno)' },
  { ts: '2026-09-12T10:09:00Z', card: '001', evento: 'gate_start', fase: 'Testes', detalhe: 'crivo' },
  { ts: '2026-09-12T10:12:00Z', card: '001', evento: 'gate_verdict', fase: 'Testes', detalhe: 'CONDITIONAL', resultado: 'falta teste do menu' },
  { ts: '2026-09-12T10:12:30Z', card: '001', evento: 'repair_attempt', fase: 'Testes', detalhe: 'tentativa 1/2: falta teste do menu' },
  { ts: '2026-09-12T10:13:00Z', card: '001', evento: 'human_checkpoint', chave: 'URL', resultado: 'aberto', detalhe: 'veio de EXECUTING' },
]

test('PONTA A PONTA: a tela intercala decisao do motor (fase, gate, reparo, tier, checkpoint) com os blocos de IA, e cada bloco fecha com o custo do ledger', () => {
  const marcos = linhaDoTempo({
    eventos: EVENTOS_DA_ORQUESTRACAO,
    chamadas: [ledger('2026-09-12T10:04:00Z', 'implement', 'claude', 0.4, 'claude-fable-5-1'), ledger('2026-09-12T10:06:00Z', 'ideacao', 'kimi', 0.05, 'k2')],
    atividades: parseLog(LOG_DA_ORQUESTRACAO),
  })
  const tela = renderLinhaDoTempo(marcos, { color: false, largura: 70 })
  const txt = tela.join('\n')
  expect(tela[0]?.startsWith('── ▸ fase implement · vitro ──')).toBe(true)
  expect(tela.some(l => l.startsWith('── ▶ IA · implement · vitro · claude-fable-5-1 · 10:00:00 ──'))).toBe(true)
  expect(tela).toContain('┃ Vou mexer no menu.')
  expect(tela.some(l => l.startsWith('── ■ concluido · US$0.4000 · 1234 tokens · 1m35s · claude-fable-5-1 ──'))).toBe(true)
  expect(tela.some(l => l.startsWith('── ▸ fim da fase implement · aprovada ──'))).toBe(true)
  expect(txt).toContain('◇ tier gate: tier2_medio (diff pequeno)')
  expect(tela.some(l => l.startsWith('[lente 1/2] ── ▶ IA · ideacao · lente 1/2 · k2 · 10:05:00 ──')), 'o modelo vem do ledger quando o log nao o traz').toBe(true)
  expect(tela.some(l => l.startsWith('[lente 2/2] ── ▶ IA · ideacao · lente 2/2 · 10:05:00 ──'))).toBe(true)
  expect(tela.filter(l => l.length > 70), 'nenhuma linha, com ou sem raia, passa da largura pedida').toEqual([])
  expect(tela).toContain('[lente 1/2] ┃ ideia A')
  expect(tela).toContain('[lente 2/2] ┃ ideia B')
  expect(tela.some(l => l.startsWith('[lente 1/2] ── ■ concluido · US$0.0500'))).toBe(true)
  expect(txt).toContain('◆ gate Testes revisando (crivo)')
  expect(tela.some(l => l.startsWith('── ▶ IA · gate · crivo · 10:10:00 ──'))).toBe(true)
  expect(txt).toContain('◆ gate Testes CONDITIONAL — falta teste do menu')
  expect(txt).toContain('↻ reparo Testes tentativa 1/2: falta teste do menu')
  expect(tela[tela.length - 1]?.startsWith('── ⏸ esperando voce · URL (veio de EXECUTING) ──')).toBe(true)
  expect(txt).not.toContain('\x1b')
})

test('troca de harness por cota aparece como marco, e a chamada que falhou fecha em vermelho com a classe', () => {
  const marcos = linhaDoTempo({
    eventos: [],
    chamadas: [
      ledger('2026-09-12T10:01:00Z', 'implement', 'claude', 0.2, 'c', false),
      ledger('2026-09-12T10:03:00Z', 'implement', 'kimi', 0.3, 'k2'),
    ],
    atividades: parseLog('— chamada em 2026-09-12T10:00:00Z · implement · limpio —\n— concluido —\n— chamada em 2026-09-12T10:02:00Z · implement · limpio —\n— concluido —'),
  })
  const tela = renderLinhaDoTempo(marcos, { color: true, largura: 70 })
  const txt = tela.join('\n')
  expect(txt).toContain('implement: claude → kimi')
  expect(txt).toContain('troca de harness')
  const fechos = tela.filter(l => l.includes('concluido') || l.includes('falhou'))
  expect(fechos[0]).toContain('\x1b[31m')
  expect(fechos[0]).toContain('falhou (quota)')
  expect(fechos[1]).toContain('\x1b[32m')
  expect(fechos[1]).toContain('k2')
})

test('log antigo sem cabecalho (so ferramentas) ainda vira um bloco, sem rotulo e sem quebrar', () => {
  const marcos = linhaDoTempo({ eventos: [], chamadas: [], atividades: parseLog('  → Read({"file_path":"a.md"})\n  ← x') })
  const tela = renderLinhaDoTempo(marcos, { color: false, largura: 60 })
  expect(tela.some(l => l.startsWith('── ▶ IA ──'))).toBe(true)
  expect(tela).toContain('● Read(a.md)')
})

test('REGRESSAO o resultado da ferramenta preenche a LARGURA do terminal — nao para em 160 nem em 100 caracteres', () => {
  const longo = 'The file /home/rpolan/projects/.hicode-worktrees/hicode-site/007-os-icones-do-site-esta-muito-fora-do-padrao/src/components/Header.vue has been updated successfully with the new icon set and spacing rules that the design asked for'
  const at = parseLog(`  → Edit({"file_path":"Header.vue"})\n  ← ${longo}`)
  const estreita = renderExecucao(at, { color: false, largura: 100 })
  expect(estreita[1]?.length).toBe(100)
  expect(estreita[1]?.endsWith('…')).toBe(true)
  const larga = renderExecucao(at, { color: false, largura: 260 })
  expect(larga[1]).toBe(`  ⎿ ${longo}`)
})
