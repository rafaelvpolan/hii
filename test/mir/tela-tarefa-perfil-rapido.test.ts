import { test, expect, afterAll } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = mkdtempSync(join(tmpdir(), 'hicode-telarapida-'))
process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(process.env.HICODE_CARDS_DIR, { recursive: true })
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const { createCard } = await import('../../motor/cdl/store.ts')
const { cabecalhoDaTarefa } = await import('../../motor/mir/cli/tela-tarefa.ts')
const { newSession, seguir } = await import('../../motor/mir/sessao.ts')

// O perfil `visual` roda ZERO passo de pipeline — e era exatamente o card do
// incidente. Um early return em "sem passos" escondia o painel do motor justamente
// na tarefa rapida, onde acompanhar importa mais porque ela acaba antes.
test('REGRESSAO: card sem NENHUM passo ainda mostra o painel do motor', () => {
  const id = createCard({
    title: 'combinar as cores do podium',
    status: 'EXECUTING',
    repo: 'org/app',
    steps_profile: 'visual',
    escopo_alvos: 'ui-lab/leaderboard.html',
    escopo_refs: 'barbeiro-frontend',
    cost_usd: '0.4210',
  }, '## Objetivo\ncombinar as cores\n')
  const linhas = cabecalhoDaTarefa(seguir(newSession('org/app'), id)).join('\n')
  expect(linhas, 'o perfil e a primeira coisa que a pessoa quer saber').toContain('visual')
  expect(linhas, 'onde ele PODE escrever').toContain('ui-lab/leaderboard.html')
  expect(linhas, 'o que ele so le').toContain('barbeiro-frontend')
  expect(linhas).toContain('0.4210')
})

// Sem renderProcessos nao ha quem mostre agente e ultima acao. Omiti-las tambem no
// painel deixaria o card rapido sem nenhuma das duas — e no ambiente de teste os
// campos vazios somem por regra, entao o que se confere aqui e a DECISAO no codigo.
test('INVARIANTE sem passos, agente e ultima acao NAO sao omitidas do painel', async () => {
  const fonte = await Bun.file('motor/mir/cli/tela-tarefa.ts').text()
  expect(fonte, 'omitir condicional ao numero de passos').toContain("passos.length ? ['agentes', 'ultima acao'] : []")
})

// renderFrame corta o pinado pelo FIM: o que tem de sobreviver num terminal baixo e
// a decisao do motor, nao a lista de passos.
test('INVARIANTE o painel do motor vem ANTES da lista de passos no pinado', async () => {
  const fonte = await Bun.file('motor/mir/cli/tela-tarefa.ts').text()
  expect(fonte).toContain('...doMotor, ...processos')
})
