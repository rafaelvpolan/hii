import { adotarRecuperacao } from '../../motor/euclides/recuperacao-adocao.ts'
import { test, expect, beforeEach, afterEach } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { planoOrquestrado } from '../fixtures/plano-orquestrado.ts'
import { fingerprintDoTrabalho } from '../../motor/oswaldo/orquestracao/evidencias.ts'
import { diagnosticarPlanoLegado, aplicarPlanoLegado } from '../../motor/api/recuperacao-plano.ts'
import { hashRecuperacao, aplicarRecuperacao } from '../../motor/api/recuperacao.ts'
import type { PacoteRecuperacao } from '../../motor/api/recuperacao.ts'
import { diagnosticarRecuperacao, confirmarPreparacao } from '../../motor/api/diagnostico-recuperacao.ts'
import { executarPlano } from '../../motor/oswaldo/orquestracao/executar-plano.ts'
import { readCard, updateCardPorAcaoHumana } from '../../motor/cordel/store.ts'
import { chaveDoProjeto } from '../../motor/oswaldo/orquestracao/config.ts'

let dir = ''
let wt = ''
let env: NodeJS.ProcessEnv
const sha = (s: string): string => createHash('sha256').update(s).digest('hex')
beforeEach(() => {
  env = { ...process.env }
  dir = mkdtempSync(join(tmpdir(), 'hii-migracao-plano-'))
  const repo = join(dir, 'repo')
  mkdirSync(repo)
  execFileSync('git', ['init', '-q', repo])
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'base'])
  wt = join(dir, 'worktree')
  execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', '-b', 'tarefa-legada', wt])
  process.env.HII_CARDS_DIR = join(dir, 'destino')
  process.env.HII_REPOS_FILE = join(dir, 'repos.json')
  process.env.HII_IA_FILE = join(dir, 'ia.json')
  process.env.HII_RUNNER_PIDFILE = join(dir, 'daemon.pid')
  mkdirSync(process.env.HII_CARDS_DIR)
  writeFileSync(process.env.HII_REPOS_FILE, JSON.stringify([{ name: 'org/app', path: repo }]))
  writeFileSync(process.env.HII_IA_FILE, '{}')
  writeFileSync(join(wt, 'A.txt'), 'efeito anterior preservado')
})
afterEach(() => { process.env = env; rmSync(dir, { recursive: true, force: true }) })
async function pacote(): Promise<PacoteRecuperacao> {
  const plano = { ...planoOrquestrado(), id: '025', sessaoId: '025', repo: 'org/app' }
  plano.microtasks = plano.microtasks.slice(0, 2)
  const hash = sha(JSON.stringify(plano))
  const instante = new Date().toISOString()
  const checkpoint = { versao: 1, hash, feitas: ['A'], fingerprint: await fingerprintDoTrabalho(wt),
    tentativas: [{ microtask: 'A', inicio: instante, fim: instante, provedor: 'claude', modelo: 'fixture', estado: 'concluida', custo: '0.15', motivo: 'concluida' },
      { microtask: 'B', inicio: instante, fim: instante, provedor: 'claude', modelo: 'fixture', estado: 'falhou', custo: '0.10', motivo: 'falhou' }] }
  const anexar = (nome: string, valor: object) => { const conteudo = JSON.stringify(valor); return { nome, conteudo: Buffer.from(conteudo).toString('base64'), sha256: sha(conteudo) } }
  return { versao: 1, origem: sha('origem-plano-025'), arquivo: '025-legada.md', repo: 'org/app',
    documento: '---\nid: 025\ntitle: Legada\nrepo: org/app\nstatus: PAUSED\ncost_usd: 0.25\nworktree: ' + wt +
      '\nbranch: tarefa-legada\nplano_revisao: 1\nplano_hash: ' + hash + '\n---\nObjetivo e historico',
    anexos: [anexar('planos/' + chaveDoProjeto('org/app') + '-025.json', { versao: 1, revisoes: [{ revisao: 1, chave: 'original', hash, plano }] }),
      anexar('orquestracao/execucao-025-1.json', checkpoint)] }
}
test('preparo migra plano e retoma apenas a microtask pendente, preservando custo e trabalho', async () => {
  const p = await pacote()
  const importada = aplicarRecuperacao(p, hashRecuperacao(p))
  const id = importada.tarefa!
  const d = await diagnosticarRecuperacao(id)
  expect(d.bloqueios).toEqual([])
  expect(d.plano?.concluidas).toEqual(['A'])
  confirmarPreparacao(d)
  expect(readCard(id)?.fm.status).toBe('PAUSED')
  expect(readCard(id)?.fm.cost_usd).toBe('0.25')
  updateCardPorAcaoHumana(id, { fields: { status: 'EXECUTING' } })
  await adotarRecuperacao(id)
  const chamadas: string[] = []
  const r = await executarPlano(readCard(id)!, wt, async card => {
    chamadas.push(card.fm.title!)
    writeFileSync(join(wt, 'B.txt'), 'novo efeito')
    return { ok: true, cost: '0.05', costMeasured: true }
  }, false)
  expect(r.ok, r.reason).toBe(true)
  expect(chamadas).toEqual(['B'])
  await adotarRecuperacao(id)
  updateCardPorAcaoHumana(id, { fields: { status: 'PAUSED' } })
  const depois = await diagnosticarRecuperacao(id)
  expect(depois.preparada).toBe(true)
  expect(depois.bloqueios).toEqual([])
  expect(readFileSync(join(wt, 'A.txt'), 'utf8')).toBe('efeito anterior preservado')
})
test('migração repetida é idempotente e checkpoint alterado no destino não é sobrescrito', async () => {
  const p = await pacote()
  const m = diagnosticarPlanoLegado(p, await fingerprintDoTrabalho(wt))!
  const a = aplicarPlanoLegado('001', p.origem, m)
  expect(aplicarPlanoLegado('001', p.origem, m)).toEqual(a)
  const file = join(process.env.HII_CARDS_DIR!, 'orquestracao/execucao-001-1.json')
  const alterado = readFileSync(file, 'utf8').replace('"feitas": [', '"feitas": ["B",')
  writeFileSync(file, alterado)
  expect(() => aplicarPlanoLegado('001', p.origem, m)).toThrow(/mudou/)
  expect(readFileSync(file, 'utf8')).toBe(alterado)
})
test('artefato ausente e fingerprint diferente bloqueiam migração sem descartar trabalho', async () => {
  const p = await pacote()
  expect(() => diagnosticarPlanoLegado({ ...p, anexos: [] }, 'a'.repeat(64))).toThrow(/ausente/)
  expect(() => diagnosticarPlanoLegado(p, 'a'.repeat(64))).toThrow(/trabalho atual/)
})

test('tentativa interrompida, custo divergente e falta de prova de conclusao exigem reconciliacao', async () => {
  const p = await pacote()
  const alterar = (mudar: (c: { tentativas: { estado: string; custo: string }[]; feitas: string[] }) => void): PacoteRecuperacao => {
    const copia = structuredClone(p)
    const a = copia.anexos[1]!
    const c = JSON.parse(Buffer.from(a.conteudo, 'base64').toString())
    mudar(c)
    const texto = JSON.stringify(c)
    a.conteudo = Buffer.from(texto).toString('base64'); a.sha256 = sha(texto)
    return copia
  }
  const fingerprint = await fingerprintDoTrabalho(wt)
  expect(() => diagnosticarPlanoLegado(alterar(c => { c.tentativas[1]!.estado = 'interrompida' }), fingerprint)).toThrow(/incerta/)
  expect(() => diagnosticarPlanoLegado(alterar(c => { c.tentativas[0]!.custo = '2.5' }), fingerprint)).toThrow(/Custo/)
  expect(() => diagnosticarPlanoLegado(alterar(c => { c.feitas = [] }), fingerprint)).toThrow(/concluida ausente/)
})

test('mudanca depois do preparo bloqueia primeiro despacho sem adotar worktree', async () => {
  const p = await pacote()
  const id = aplicarRecuperacao(p, hashRecuperacao(p)).tarefa!
  confirmarPreparacao(await diagnosticarRecuperacao(id))
  updateCardPorAcaoHumana(id, { fields: { status: 'EXECUTING' } })
  writeFileSync(join(wt, 'arquivo-humano.txt'), 'preservar')
  await expect(adotarRecuperacao(id)).rejects.toThrow(/mudou/)
  expect(readCard(id)?.fm.recuperacao_adotada).toBeFalsy()
  expect(readFileSync(join(wt, 'arquivo-humano.txt'), 'utf8')).toBe('preservar')
})

test('arquivo de origem truncado vira bloqueio explicito e nao elimina a tarefa', async () => {
  const p = await pacote()
  const id = aplicarRecuperacao(p, hashRecuperacao(p)).tarefa!
  const arquivo = join(process.env.HII_CARDS_DIR!, 'recuperacao/importacoes', p.origem + '.json')
  writeFileSync(arquivo, '{truncado')
  const d = await diagnosticarRecuperacao(id)
  expect(d.preparada).toBe(false)
  expect(d.podePreparar).toBe(false)
  expect(d.bloqueios.join(' ')).toContain('ilegivel')
  expect(readCard(id)?.fm.status).toBe('PAUSED')
  expect(readFileSync(arquivo, 'utf8')).toBe('{truncado')
})
