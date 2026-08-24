import { test, expect } from 'bun:test'

const D = await import('../../motor/osw/despacho-de-agentes.ts')

test('as especs vem de FUNCAO PURA sobre o diff — mesma entrada, mesma saida', () => {
  const ctx = { arquivos: ['src/Botao.vue', 'database/migrations/2026_cria.php'] }
  expect(D.decidirEspecs(ctx)).toEqual(D.decidirEspecs(ctx))
})

test('nunca e a IA que decide chamar outro agente — sem invocacao de provedor no modulo', async () => {
  const fonte = await Bun.file('motor/osw/despacho-de-agentes.ts').text()
  for (const proibido of ['runProvider', 'implement(', 'runStep(']) {
    expect(fonte, `despacho nao pode chamar ${proibido} — quem decide specs e codigo`).not.toContain(proibido)
  }
})

test('arquivo de front e de banco no mesmo diff geram especialistas distintos', () => {
  const specs = D.decidirEspecs({ arquivos: ['src/Botao.vue', 'database/migrations/2026_cria.php'] })
  expect(specs.map(s => s.agente).sort()).toEqual(['radix', 'vitro'])
})

test('diff sem sinal nenhum nao inventa especialista', () => {
  expect(D.decidirEspecs({ arquivos: ['README.md'] })).toEqual([])
})

test('PARALELO so quando os conjuntos de arquivo sao disjuntos', () => {
  const specs = D.decidirEspecs({ arquivos: ['src/Botao.vue', 'database/migrations/2026_cria.php'] })
  const lotes = D.lotesSemSobreposicao(specs)
  expect(lotes.length, 'arquivos disjuntos podem correr juntos').toBe(1)
  expect(lotes[0]?.length).toBe(2)
})

test('SERIE quando dois especialistas tocariam o mesmo arquivo', () => {
  const specs = [
    { agente: 'vitro', papel: 'implementador' as const, arquivos: ['src/Botao.vue'] },
    { agente: 'escudo', papel: 'seguranca' as const, arquivos: ['src/Botao.vue'] },
  ]
  const lotes = D.lotesSemSobreposicao(specs)
  expect(lotes.length, 'dois agentes no mesmo arquivo em paralelo perdem trabalho um do outro').toBe(2)
})

test('despachar respeita os lotes e devolve na ordem das especs', async () => {
  const specs = D.decidirEspecs({ arquivos: ['src/Botao.vue', 'database/migrations/2026_cria.php'] })
  const vistos: string[] = []
  const r = await D.despacharAgentesNaFase(specs, async spec => {
    vistos.push(spec.agente)
    return { ok: true, agente: spec.agente }
  })
  expect(r.length).toBe(2)
  expect(vistos.sort()).toEqual(['radix', 'vitro'])
})

test('teto de agentes por fase — despacho sem limite e o mesmo loop sem teto que o motor recusa', () => {
  const muitos = Array.from({ length: 50 }, (_, i) => `src/C${i}.vue`)
  const specs = D.decidirEspecs({ arquivos: muitos })
  expect(specs.length).toBeLessThanOrEqual(D.MAX_AGENTES_POR_FASE)
})

test('sem diff (card novo), o roteamento sai da dependencia declarada do alvo', () => {
  const specs = D.decidirEspecs({ arquivos: [], deps: ['vue'] })
  expect(specs.map(s => s.agente)).toEqual(['vitro'])
})

test('sem diff e sem dep, o titulo da tarefa ainda decide', () => {
  expect(D.decidirEspecs({ arquivos: [], titulo: 'criar migration de comissao' }).map(s => s.agente)).toEqual(['radix'])
  expect(D.decidirEspecs({ arquivos: [], titulo: 'refatorar o calculo' }).map(s => s.agente)).toEqual(['rufus'])
})

test('sem sinal nenhum devolve vazio — e vazio significa NAO delegar, nao "a IA escolhe"', () => {
  expect(D.decidirEspecs({ arquivos: [], deps: [], titulo: 'algo' })).toEqual([])
})

test('INVARIANTE o prompt de implementacao nao entrega o menu para a IA rotear', async () => {
  const fonte = await Bun.file('motor/cic/agente.ts').text()
  expect(fonte, 'o roteamento tem de vir de decidirEspecs, nao de um menu no prompt').toContain('decidirEspecs(')
  expect(fonte).not.toContain('function roteamentoImplement')
})
