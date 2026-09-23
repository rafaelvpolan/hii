import { test, expect, beforeEach, afterEach } from '../apoio/runner.ts'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executarRevisoes, analisarParecer, consolidarAchados, validarPoliticaDeRevisao } from '../../motor/ciclo/crivo/revisoes.ts'
import type { EntradaDeRevisoes, PoliticaDeRevisao, Parecer, Achado } from '../../motor/ciclo/crivo/revisoes.ts'
import { emptyUsage } from '../../motor/tomada/uso.ts'
import { submit } from '../../motor/mirante/acoes.ts'
import { patchCard } from '../../motor/cordel/store.ts'

let dir = ''
let env: NodeJS.ProcessEnv
let entrada: EntradaDeRevisoes
const revisor = { papel: 'seguranca', provedor: 'claude', dominio: 'seguranca', obrigatorio: true, ativo: true }
const politica: PoliticaDeRevisao = { versao: 1, revisao: 1, revisores: [revisor] }
const catalogo = { seguranca: { description: 'Seguranca', prompt: 'Revise seguranca.' } }
function resposta(estado = 'aprovado', achados: Achado[] = []) {
  return { ok: true, failed: false, isError: false, timedOut: false, detail: '', cost: 0.2, costMeasured: true, usage: emptyUsage(),
    text: JSON.stringify({ estado, motivo: 'Verificado no diff', coberturaCompleta: true, arquivos: ['app.ts'], achados }) }
}
beforeEach(() => {
  env = { ...process.env }
  dir = mkdtempSync(join(tmpdir(), 'hii-revisoes-'))
  execFileSync('git', ['init', '-q', dir])
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'base'])
  execFileSync('git', ['-C', dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD'])
  process.env.HII_CARDS_DIR = join(dir, '.git', 'estado')
  process.env.HII_IA_FILE = join(dir, '.git', 'ia.json')
  const id = submit({ title: 'Revisoes', repo: 'org/app' })
  patchCard(id, { status: 'REVIEW' })
  writeFileSync(join(dir, 'app.ts'), 'export const n = 1')
  entrada = { id, wt: dir, base: 'main', objetivo: 'Revisar', risco: 'low', nomes: ['app.ts'], diff: '+export const n = 1', parcial: false, criterios: ['c-erro'] }
})
afterEach(() => { process.env = env; rmSync(dir, { recursive: true, force: true }) })

test('parecer completo persiste e reutiliza sem repetir chamada nem custo', async () => {
  let chamadas = 0
  const executar: Parameters<typeof executarRevisoes>[2] = async (_id, _h, req) => {
    chamadas++
    expect(req.mode).toBe('readonly')
    expect(req.useAgents).toBe(false)
    return resposta()
  }
  expect((await executarRevisoes(entrada, politica, executar, catalogo)).aprovado).toBe(true)
  const cache = await executarRevisoes(entrada, politica, executar, catalogo)
  expect(cache.custo).toBe(0)
  expect(chamadas).toBe(1)
  patchCard(entrada.id, { status: 'PAUSED' })
  await expect(executarRevisoes(entrada, politica, executar, catalogo)).rejects.toThrow('operador')
})

test('concorrencia reserva antes da inferencia e nao repete chamada', async () => {
  let liberar!: () => void
  let iniciou!: () => void
  const inicio = new Promise<void>(r => { iniciou = r })
  const espera = new Promise<void>(r => { liberar = r })
  let chamadas = 0
  const primeira = executarRevisoes(entrada, politica, async () => { chamadas++; iniciou(); await espera; return resposta() }, catalogo)
  await inicio
  try {
    await expect(executarRevisoes(entrada, politica, async () => { chamadas++; return resposta() }, catalogo)).rejects.toThrow('reconciliacao')
  } finally { liberar() }
  expect((await primeira).aprovado).toBe(true)
  expect(chamadas).toBe(1)
})

test('parecer sem cobertura e excecao de custo desconhecido nao aprovam', async () => {
  const r = await executarRevisoes(entrada, politica, async () => { throw new Error('resposta perdida') }, catalogo)
  expect(r.aprovado).toBe(false)
  expect(r.custoMedido).toBe(false)
  const incompleta = resposta()
  incompleta.text = incompleta.text.replace('"app.ts"', '"outro.ts"')
  const nova = { ...politica, revisao: 2 }
  expect((await executarRevisoes(entrada, nova, async () => incompleta, catalogo)).aprovado).toBe(false)
})

test('mudanca no trabalho ou parada durante chamada invalida aprovacao', async () => {
  const r = await executarRevisoes(entrada, politica, async () => {
    writeFileSync(join(dir, 'app.ts'), 'export const n = 2')
    return resposta()
  }, catalogo)
  expect(r.aprovado).toBe(false)
  expect(r.invalidado).toBe(true)
  expect(r.custo).toBe(0.2)
})

test('catalogo obrigatorio ausente e diff parcial nao consomem inferencia', async () => {
  let chamadas = 0
  const executar: Parameters<typeof executarRevisoes>[2] = async () => { chamadas++; return resposta() }
  expect((await executarRevisoes(entrada, politica, executar, {})).aprovado).toBe(false)
  expect((await executarRevisoes({ ...entrada, parcial: true }, { ...politica, revisao: 2 }, executar, catalogo)).aprovado).toBe(false)
  expect(chamadas).toBe(0)
})

test('cache adulterado recusa aprovacao', async () => {
  await executarRevisoes(entrada, politica, async () => resposta(), catalogo)
  const pasta = join(process.env.HII_CARDS_DIR!, 'revisoes')
  const arquivo = join(pasta, readdirSync(pasta).find(f => f.endsWith('.json'))!)
  const envelope = JSON.parse(readFileSync(arquivo, 'utf8'))
  envelope.relatorio.aprovado = false
  writeFileSync(arquivo, JSON.stringify(envelope))
  await expect(executarRevisoes(entrada, politica, async () => resposta(), catalogo)).rejects.toThrow('inconsistente')
})

test('achados exigem evidencia e deduplicacao conserva autoria', () => {
  const achado: Achado = { severidade: 'P1', dominio: 'seguranca', descricao: 'Entrada sem validacao', arquivo: 'app.ts', linha: 1, evidencia: 'Entrada chega ao shell', recomendacao: 'Usar argv', criterio: 'c-erro' }
  expect(() => analisarParecer(resposta('aprovado', [achado]).text, revisor, entrada)).toThrow()
  expect(() => analisarParecer(resposta('bloqueado', [{ ...achado, evidencia: '' }]).text, revisor, entrada)).toThrow()
  const p: Parecer = { fonte: { papel: 'seguranca', provedor: 'claude', modelo: '' }, obrigatorio: true, estado: 'bloqueado', motivo: 'Falha', achados: [achado], coberturaCompleta: true, arquivos: ['app.ts'], custo: 0, tokens: 0 }
  const lista = consolidarAchados([p, { ...p, fonte: { ...p.fonte, provedor: 'codex' } }])
  expect(lista.length).toBe(1)
  expect(lista[0]!.fontes.length).toBe(2)
  expect(() => validarPoliticaDeRevisao({ ...politica, revisores: [] })).toThrow()
})

test('gate integra especialistas sem dispensar o Crivo existente', async () => {
  const { mkdirSync } = await import('node:fs')
  const { configurar, configuracao } = await import('../../motor/api/configuracao.ts')
  const { runGatedReview, buildPrBody } = await import('../../motor/ciclo/crivo/gate.ts')
  const { providerFor } = await import('../../motor/tomada/registro.ts')
  const agents = join(dir, '.git', 'agents')
  mkdirSync(agents)
  process.env.HII_AGENTS_DIR = agents
  process.env.HII_GATE_PROVIDER = 'claude'
  writeFileSync(join(agents, 'seguranca.md'), '---\nname: seguranca\ndescription: Seguranca\n---\nRevise seguranca.')
  const { ler, aplicar } = await import('../../motor/tomada/escolha-de-ia.ts')
  const { etagDe } = await import('../../motor/cordel/revisao.ts')
  expect(aplicar({ papeis: ['gate'], revisao: politica, autoReview: true }, etagDe(ler())).ok).toBe(true)
  expect(() => configurar({ versao: 1, papel: 'gate', revisao: { ...politica, revisores: [] } }, etagDe(ler()))).toThrow()
  expect(configuracao().status).toBe(200)
  const h = providerFor('gate')
  const original = h.run
  const chamadas: string[] = []
  h.run = async req => {
    chamadas.push(req.rotulo || '')
    if (req.rotulo?.startsWith('review')) return resposta('inconclusivo')
    return { ...resposta(), text: '{"verdict":"APPROVED","reason":"Crivo aprovado","questions":[]}' }
  }
  try {
    const r = await runGatedReview(dir, 'main', 'Revisar', entrada.id)
    expect(r.ok).toBe(false)
    expect(r.verdict).toBe('BLOCKED')
    expect(r.cost).toBe(0.4)
    expect(chamadas.length).toBe(2)
    expect(buildPrBody(entrada.id, 'Revisar', r)).toContain('seguranca / claude')
  } finally { h.run = original }
})

test('revisao humana e o padrao e nao chama especialistas automaticamente', async () => {
  const { mkdirSync } = await import('node:fs')
  const { runGatedReview } = await import('../../motor/ciclo/crivo/gate.ts')
  const { providerFor } = await import('../../motor/tomada/registro.ts')
  const { ler, aplicar } = await import('../../motor/tomada/escolha-de-ia.ts')
  const { etagDe } = await import('../../motor/cordel/revisao.ts')
  const agents = join(dir, '.git', 'agents-human')
  mkdirSync(agents)
  process.env.HII_AGENTS_DIR = agents
  process.env.HII_GATE_PROVIDER = 'claude'
  writeFileSync(join(agents, 'seguranca.md'), '---\nname: seguranca\ndescription: Seguranca\n---\nRevise seguranca.')
  expect(aplicar({ papeis: ['gate'], revisao: politica, autoReview: false }, etagDe(ler())).ok).toBe(true)
  expect(ler().gate?.autoReview).toBe(false)
  const h = providerFor('gate')
  const original = h.run
  const chamadas: string[] = []
  h.run = async req => { chamadas.push(req.rotulo || ''); return { ...resposta(), text: '{"verdict":"APPROVED","reason":"Crivo aprovado","questions":[]}' } }
  try {
    const r = await runGatedReview(dir, 'main', 'Revisar', entrada.id)
    expect(r.ok).toBe(true)
    expect(chamadas).toEqual(['gate · crivo'])
  } finally { h.run = original }
})

test('API aceita escolha explicita e recusa auto review sem politica ou fora do gate', async () => {
  const { configurar } = await import('../../motor/api/configuracao.ts')
  const { ler } = await import('../../motor/tomada/escolha-de-ia.ts')
  const { etagDe } = await import('../../motor/cordel/revisao.ts')
  expect(() => configurar({ versao: 1, papel: 'verify', autoReview: true }, etagDe(ler()))).toThrow('gate')
  expect(() => configurar({ versao: 1, papel: 'gate', autoReview: true }, etagDe(ler()))).toThrow('politica')
  expect(configurar({ versao: 1, papel: 'gate', autoReview: false }, etagDe(ler())).status).toBe(200)
  expect(ler().gate?.autoReview).toBe(false)
})

test('API torna politica de localidade visivel sem fingir que e editavel', async () => {
  const { configuracao } = await import('../../motor/api/configuracao.ts')
  process.env.HII_EXECUTION_LOCALITY = 'somente_local'
  process.env.HII_REMOTE_FALLBACK = 'on'
  try {
    const corpo = JSON.parse(configuracao().corpo) as { execucao: { localidade: string; fallbackRemoto: boolean; editavel: boolean } }
    expect(corpo.execucao).toEqual({ localidade: 'somente_local', fallbackRemoto: false, editavel: false })
  } finally {
    delete process.env.HII_EXECUTION_LOCALITY
    delete process.env.HII_REMOTE_FALLBACK
  }
})

test('custo desconhecido interrompe proximos revisores obrigatorios', async () => {
  let chamadas = 0
  const r = await executarRevisoes(entrada, { ...politica, revisores: [revisor, { ...revisor, papel: 'arquitetura' }] }, async () => {
    chamadas++; return { ...resposta(), costMeasured: false }
  }, { ...catalogo, arquitetura: catalogo.seguranca })
  expect(chamadas).toBe(1)
  expect(r.aprovado).toBe(false)
  expect(r.custoMedido).toBe(false)
  expect(r.pareceres[1]!.motivo).toContain('custo anterior desconhecido')
})

test('timeout com texto positivo nao aprova e parecer opcional desabilitado nao chama IA', async () => {
  let chamadas = 0
  const p = { ...politica, revisores: [revisor, { ...revisor, papel: 'opcional', ativo: false, obrigatorio: false }] }
  const r = await executarRevisoes(entrada, p, async () => {
    chamadas++; return { ...resposta(), timedOut: true }
  }, catalogo)
  expect(r.aprovado).toBe(false)
  expect(r.pareceres[1]!.estado).toBe('desabilitado')
  expect(chamadas).toBe(1)
})

test('nova base ou commit invalida cache de parecer', async () => {
  let chamadas = 0
  const executar: Parameters<typeof executarRevisoes>[2] = async () => { chamadas++; return resposta() }
  await executarRevisoes(entrada, politica, executar, catalogo)
  execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'novo head'])
  const r = await executarRevisoes(entrada, politica, executar, catalogo)
  expect(chamadas).toBe(2)
  expect(r.head).toBe(execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim())
})

test('parada humana durante resposta positiva bloqueia gate e preserva custo', async () => {
  const r = await executarRevisoes(entrada, politica, async () => {
    patchCard(entrada.id, { status: 'PAUSED' })
    return resposta()
  }, catalogo)
  expect(r.aprovado).toBe(false)
  expect(r.custo).toBe(0.2)
})
