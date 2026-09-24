import { test, expect, beforeEach, afterEach } from '../apoio/runner.ts'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { submit } from '../../motor/mirante/acoes.ts'
import { readCard, patchCard } from '../../motor/cordel/store.ts'
import { salvarPlano } from '../../motor/oswaldo/orquestracao/planos.ts'
import { executarPlano } from '../../motor/oswaldo/orquestracao/executar-plano.ts'
import { arquivoDoOrquestrador } from '../../motor/oswaldo/orquestracao/config.ts'
import { marcarEmVoo, liberar } from '../../motor/oswaldo/mutirao/estado-da-fila.ts'
import { planoOrquestrado } from '../fixtures/plano-orquestrado.ts'

let dir = '', wt = '', id = ''
let anterior: NodeJS.ProcessEnv
beforeEach(() => {
  anterior = { ...process.env }
  dir = mkdtempSync(join(tmpdir(), 'hii-paralelo-'))
  process.env.HII_CARDS_DIR = join(dir, 'cards')
  process.env.HII_MEM_TOTAL_MB = '8192'
  process.env.HII_CPUS_TOTAL = '4'
  process.env.HII_MEM_POR_WORKTREE_MB = '1024'
  const repo = join(dir, 'repo')
  execFileSync('git', ['init', '-q', repo])
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'test@hii'])
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'test'])
  execFileSync('git', ['-C', repo, 'commit', '--allow-empty', '-qm', 'base'])
  wt = join(dir, 'worktree')
  execFileSync('git', ['-C', repo, 'worktree', 'add', '-qb', 'fixture-execucao', wt])
  id = submit({ title: 'Paralelo', repo: 'org/app', motor_modo: 'passivo' })
  patchCard(id, { status: 'EXECUTING', worktree: wt, branch: 'fixture-execucao', sessao_id: id })
  const arquivo = arquivoDoOrquestrador('org/app')
  mkdirSync(join(process.env.HII_CARDS_DIR!, 'orquestracao'), { recursive: true })
  writeFileSync(arquivo, JSON.stringify({ versao: 1, projeto: 'org/app', modo: 'gateway', concorrencia: 1, concorrenciaMicrotasks: 2, revisao: 1 }))
  marcarEmVoo(id)
})
afterEach(() => { liberar(id); process.env = anterior; rmSync(dir, { recursive: true, force: true }) })

test('A -> B/C -> D usa worktrees distintos, integra e revalida antes da sucessora', async () => {
  const plano = { ...planoOrquestrado(), id, sessaoId: id }
  plano.criterios = ['A', 'B', 'C', 'D'].map(nome => ({
    id: nome, descricao: nome + ' existe', obrigatorio: true,
    comando: { binario: 'node', argumentos: ['--input-type=module', '-e', "import { accessSync } from 'node:fs'; accessSync('" + nome + ".txt')"], diretorio: '.', timeoutMs: 3000 },
  }))
  for (const m of plano.microtasks) m.criterios = [m.id]
  salvarPlano(plano, 0, 'paralelo')
  const locais = new Map<string, string>()
  let liberarRamos: () => void = () => {}
  const ambos = new Promise<void>(resolve => { liberarRamos = resolve })
  const resultado = await executarPlano(readCard(id)!, wt, async (card, cwd) => {
    const nome = card.fm.title!
    locais.set(nome, cwd)
    if (nome === 'B' || nome === 'C') {
      if (locais.has('B') && locais.has('C')) liberarRamos()
      const paralelo = await Promise.race([ambos.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 1000))])
      if (!paralelo) return { ok: false, cost: '0', costMeasured: true, reason: 'ramo nao iniciou em paralelo' }
      expect(readFileSync(join(cwd, 'A.txt'), 'utf8')).toBe('A')
    }
    if (nome === 'D') {
      expect(readFileSync(join(cwd, 'B.txt'), 'utf8')).toBe('B')
      expect(readFileSync(join(cwd, 'C.txt'), 'utf8')).toBe('C')
    }
    writeFileSync(join(cwd, nome + '.txt'), nome)
    return { ok: true, cost: '0.1', costMeasured: true }
  }, false)
  expect(resultado.ok).toBe(true)
  expect(locais.get('B')).not.toBe(wt)
  expect(locais.get('B')).not.toBe(locais.get('C'))
  expect(locais.get('D')).toBe(wt)
  for (const nome of ['A', 'B', 'C', 'D']) expect(readFileSync(join(wt, nome + '.txt'), 'utf8')).toBe(nome)
  expect(Number(resultado.cost)).toBe(0.4)
  let repetidas = 0
  expect((await executarPlano(readCard(id)!, wt, async () => { repetidas++; return { ok: true, cost: '0', costMeasured: true } }, false)).ok).toBe(true)
  expect(repetidas).toBe(0)
})

test('arquivos compartilhados e falta de slots mantem execucao serial', async () => {
  const plano = { ...planoOrquestrado(), id, sessaoId: id }
  plano.microtasks[1]!.arquivos = ['compartilhado.txt']
  plano.microtasks[2]!.arquivos = ['compartilhado.txt']
  salvarPlano(plano, 0, 'conflito-declarado')
  const locais: string[] = []
  const r = await executarPlano(readCard(id)!, wt, async (_, cwd) => {
    locais.push(cwd)
    return { ok: true, cost: '0', costMeasured: true }
  }, false)
  expect(r.ok).toBe(true)
  expect(locais).toEqual([wt, wt, wt, wt])
  const outro = submit({ title: 'Sem recursos', repo: 'org/app', motor_modo: 'passivo' })
  patchCard(outro, { status: 'EXECUTING', worktree: wt, branch: 'fixture-execucao', sessao_id: outro })
  salvarPlano({ ...planoOrquestrado(), id: outro, sessaoId: outro }, 0, 'limite')
  marcarEmVoo(outro)
  process.env.HII_MEM_TOTAL_MB = '1'
  try {
    locais.length = 0
    expect((await executarPlano(readCard(outro)!, wt, async (_, cwd) => { locais.push(cwd); return { ok: true, cost: '0', costMeasured: true } }, false)).ok).toBe(true)
    expect(locais).toEqual([wt, wt, wt, wt])
  } finally { liberar(outro) }
})

test('efeito fora do escopo do ramo bloqueia integracao e conserva arquivos', async () => {
  salvarPlano({ ...planoOrquestrado(), id, sessaoId: id }, 0, 'escopo')
  const locais = new Map<string, string>()
  const r = await executarPlano(readCard(id)!, wt, async (card, cwd) => {
    const nome = card.fm.title!
    locais.set(nome, cwd)
    writeFileSync(join(cwd, nome + '.txt'), nome)
    if (nome === 'B') writeFileSync(join(cwd, 'fora.txt'), 'preservar para inspecao')
    return { ok: true, cost: '0.1', costMeasured: true }
  }, false)
  expect(r.ok).toBe(false)
  expect(r.reason).toContain('escopo')
  expect(locais.has('D')).toBe(false)
  expect(readFileSync(join(locais.get('B')!, 'fora.txt'), 'utf8')).toBe('preservar para inspecao')
  let repetidas = 0
  expect((await executarPlano(readCard(id)!, wt, async () => { repetidas++; return { ok: true, cost: '0', costMeasured: true } }, false)).ok).toBe(false)
  expect(repetidas).toBe(0)
})

test('crash apos merge e antes do checkpoint reconhece os dois pais sem repetir IA', async () => {
  const plano = { ...planoOrquestrado(), id, sessaoId: id }
  plano.microtasks = plano.microtasks.slice(0, 3)
  const revisao = salvarPlano(plano, 0, 'crash-merge')
  let chamadas = 0
  const implementar: Parameters<typeof executarPlano>[2] = async (card, cwd) => {
    chamadas++
    writeFileSync(join(cwd, card.fm.title + '.txt'), card.fm.title!)
    return { ok: true, cost: '0.1', costMeasured: true }
  }
  expect((await executarPlano(readCard(id)!, wt, implementar, false)).ok).toBe(true)
  const arquivo = join(process.env.HII_CARDS_DIR!, 'orquestracao', 'execucao-' + id + '-' + revisao.revisao + '.json')
  const c = JSON.parse(readFileSync(arquivo, 'utf8')) as import('../../motor/oswaldo/orquestracao/checkpoint.ts').Checkpoint
  c.feitas = ['A']
  c.tentativas = c.tentativas!.filter(t => t.microtask === 'A')
  c.fingerprint = 'checkpoint anterior ao ultimo merge'
  c.paralela!.estado = 'ativa'
  const ultimo = c.paralela!.ramos.at(-1)!
  ultimo.estado = 'integrando'
  delete ultimo.integradoHead
  writeFileSync(arquivo, JSON.stringify(c))
  // Rollback de configuracao deve reconciliar o que ja iniciou.
  const config = JSON.parse(readFileSync(arquivoDoOrquestrador('org/app'), 'utf8')) as { concorrenciaMicrotasks: number }
  config.concorrenciaMicrotasks = 1
  writeFileSync(arquivoDoOrquestrador('org/app'), JSON.stringify(config))
  const retomada = await executarPlano(readCard(id)!, wt, implementar, false)
  expect(retomada.ok).toBe(true)
  expect(retomada.cost).toBe('0')
  expect(chamadas).toBe(3)
  for (const nome of ['A', 'B', 'C']) expect(readFileSync(join(wt, nome + '.txt'), 'utf8')).toBe(nome)
})

test('parada humana conserva ramos prontos e retoma somente a integracao', async () => {
  const { updateCardPorAcaoHumana } = await import('../../motor/cordel/store.ts')
  const plano = { ...planoOrquestrado(), id, sessaoId: id }
  salvarPlano(plano, 0, 'parada-paralela')
  const chamadas: string[] = []
  let concluirB: () => void = () => {}
  const b = new Promise<void>(resolve => { concluirB = resolve })
  const implementar: Parameters<typeof executarPlano>[2] = async (card, cwd) => {
    const nome = card.fm.title!
    chamadas.push(nome)
    writeFileSync(join(cwd, nome + '.txt'), nome)
    if (nome === 'B') await b
    if (nome === 'C') {
      patchCard(id, { status: 'HALTED', halt_class: 'humano', halt_reason: 'parar' })
      concluirB()
    }
    return { ok: true, cost: '0.1', costMeasured: true }
  }
  const parado = await executarPlano(readCard(id)!, wt, implementar, false)
  expect(parado.ok).toBe(false)
  expect(Number(parado.cost)).toBeGreaterThan(0.29)
  expect(chamadas).toEqual(['A', 'B', 'C'])
  updateCardPorAcaoHumana(id, { fields: { status: 'EXECUTING' } })
  const retomada = await executarPlano(readCard(id)!, wt, implementar, false)
  expect(retomada.ok).toBe(true)
  expect(chamadas).toEqual(['A', 'B', 'C', 'D'])
  expect(retomada.cost).toBe('0.1')
})

test('prova isolada nao substitui criterios do trabalho combinado', async () => {
  const plano = { ...planoOrquestrado(), id, sessaoId: id }
  plano.criterios[0]!.comando = { binario: 'node', argumentos: ['--input-type=module', '-e', "import * as f from 'node:fs'; if(f.existsSync('B.txt')&&f.existsSync('C.txt')) process.exit(9)"], diretorio: '.', timeoutMs: 3000 }
  salvarPlano(plano, 0, 'combinado')
  const chamadas: string[] = []
  const implementar: Parameters<typeof executarPlano>[2] = async (card, cwd) => {
    chamadas.push(card.fm.title!)
    writeFileSync(join(cwd, card.fm.title + '.txt'), card.fm.title!)
    return { ok: true, cost: '0', costMeasured: true }
  }
  const r = await executarPlano(readCard(id)!, wt, implementar, false)
  expect(r.ok).toBe(false)
  expect(r.reason).toContain('combinados')
  expect(chamadas).toEqual(['A', 'B', 'C'])
  expect((await executarPlano(readCard(id)!, wt, implementar, false)).ok).toBe(false)
  expect(chamadas).toEqual(['A', 'B', 'C'])
})

test('ramos ocupam os slots da fila ate todos terminarem e os liberam apos falha', async () => {
  const { quantosSlotsOcupados, reservarSlotsMicrotasks } = await import('../../motor/oswaldo/mutirao/estado-da-fila.ts')
  salvarPlano({ ...planoOrquestrado(), id, sessaoId: id }, 0, 'slots')
  const r = await executarPlano(readCard(id)!, wt, async (card, cwd) => {
    const nome = card.fm.title!
    if (nome === 'B' || nome === 'C') {
      expect(quantosSlotsOcupados()).toBe(2)
      expect(reservarSlotsMicrotasks(id, 2, 4)).toBe(null)
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    writeFileSync(join(cwd, nome + '.txt'), nome)
    return { ok: nome !== 'B', cost: '0.1', costMeasured: true }
  }, false)
  expect(r.ok).toBe(false)
  expect(quantosSlotsOcupados()).toBe(1)
  const reserva = reservarSlotsMicrotasks(id, 2, 2)
  expect(typeof reserva).toBe('function')
  expect(quantosSlotsOcupados()).toBe(2)
  reserva!()
  reserva!()
  expect(quantosSlotsOcupados()).toBe(1)
})

test('custo desconhecido em um ramo preserva ambos e nao inicia sucessora', async () => {
  salvarPlano({ ...planoOrquestrado(), id, sessaoId: id }, 0, 'custo-paralelo')
  const chamadas: string[] = []
  const r = await executarPlano(readCard(id)!, wt, async (card, cwd) => {
    const nome = card.fm.title!
    chamadas.push(nome)
    writeFileSync(join(cwd, nome + '.txt'), nome)
    return { ok: true, cost: '0.1', costMeasured: nome !== 'B' }
  }, false)
  expect(r.ok).toBe(false)
  expect(r.costMeasured).toBe(false)
  expect(r.reason).toContain('custo')
  expect(chamadas).toEqual(['A', 'B', 'C'])
})

test('cota em ramo limpo redistribui sem perder historico da tentativa', async () => {
  const plano = { ...planoOrquestrado(), id, sessaoId: id }
  salvarPlano(plano, 0, 'fallback-paralelo')
  const chamadas: string[] = []
  const r = await executarPlano(readCard(id)!, wt, async (card, cwd) => {
    const nome = card.fm.title!
    const provider = card.fm.provider_override_implement || 'claude'
    chamadas.push(nome + ':' + provider)
    if (nome === 'B' && provider === 'claude') return { ok: false, reason: 'quota', failureClass: 'quota', provider, cost: '0.01', costMeasured: true }
    writeFileSync(join(cwd, nome + '.txt'), nome)
    return { ok: true, provider, cost: '0.1', costMeasured: true }
  }, false, { rota: () => ({ acao: 'trocar', para: 'codex', motivo: 'fixture' }) })
  expect(r.ok).toBe(true)
  expect(chamadas).toContain('B:claude')
  expect(chamadas).toContain('B:codex')
  const revisao = readCard(id)!.fm.plano_revisao!
  const checkpoint = JSON.parse(readFileSync(join(process.env.HII_CARDS_DIR!, 'orquestracao', `execucao-${id}-${revisao}.json`), 'utf8')) as import('../../motor/oswaldo/orquestracao/checkpoint.ts').Checkpoint
  expect(checkpoint.tentativas!.filter(t => t.microtask === 'B').map(t => [t.provedor, t.estado])).toEqual([['claude', 'falhou'], ['codex', 'concluida']])
})

test('nao redistribui ramo com efeito incerto', async () => {
  salvarPlano({ ...planoOrquestrado(), id, sessaoId: id }, 0, 'efeito-incerto')
  let rotas = 0
  const incerto = await executarPlano(readCard(id)!, wt, async (card, cwd) => {
    if (card.fm.title === 'B') {
      writeFileSync(join(cwd, 'B.txt'), 'efeito antes da falha')
      return { ok: false, reason: 'quota', failureClass: 'quota', provider: 'claude', cost: '0', costMeasured: true }
    }
    writeFileSync(join(cwd, card.fm.title + '.txt'), card.fm.title!)
    return { ok: true, provider: 'claude', cost: '0', costMeasured: true }
  }, false, { rota: () => { rotas++; return { acao: 'trocar', para: 'codex', motivo: 'fixture' } } })
  expect(incerto.ok).toBe(false)
  expect(rotas).toBe(0)
})

test('nao redistribui ramo com IA atribuida pelo plano', async () => {
  const fixo = planoOrquestrado()
  fixo.id = id; fixo.sessaoId = id
  fixo.microtasks[1]!.ia = { provedor: 'claude' }
  salvarPlano(fixo, 0, 'ia-fixa')
  let rotas = 0
  const resultado = await executarPlano(readCard(id)!, wt, async (card, cwd) => {
    if (card.fm.title === 'B') return { ok: false, reason: 'quota', failureClass: 'quota', provider: 'claude', cost: '0', costMeasured: true }
    writeFileSync(join(cwd, card.fm.title + '.txt'), card.fm.title!)
    return { ok: true, provider: 'claude', cost: '0', costMeasured: true }
  }, false, { rota: () => { rotas++; return { acao: 'trocar', para: 'codex', motivo: 'fixture' } } })
  expect(resultado.ok).toBe(false)
  expect(rotas).toBe(0)
})
