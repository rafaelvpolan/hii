import { test, expect, afterEach } from '../apoio/runner.ts'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { numeroDeEnv } from '../../motor/cordel/alicerce/config.ts'
import { disponibilidadeExterna } from '../../motor/tomada/ponte/estado.ts'
import type { ConsultaMcp, ServidorMcp } from '../../motor/tomada/ponte/estado.ts'
import { syncWithBase } from '../../motor/quilombo/cartorio/sync.ts'
import { runCodefoxGate } from '../../motor/ciclo/crivo/gate.ts'

const criados: string[] = []
function dirTemp(prefixo: string): string {
  const d = mkdtempSync(join(tmpdir(), prefixo))
  criados.push(d)
  return d
}

afterEach(() => {
  delete process.env.HICODE_TESTE_NUM
  for (const d of criados.splice(0)) rmSync(d, { recursive: true, force: true })
})

function repoGit(): string {
  const d = dirTemp('hicode-aud-git-')
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: d })
  execFileSync('git', ['config', 'user.email', 'a@b.c'], { cwd: d })
  execFileSync('git', ['config', 'user.name', 'teste'], { cwd: d })
  writeFileSync(join(d, 'a.txt'), 'inicial\n')
  execFileSync('git', ['add', '-A'], { cwd: d })
  execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'inicial'], { cwd: d })
  return d
}

test('REGRESSAO o gate vinculante falha FECHADO quando o git nao roda — antes aprovava', async () => {
  const wt = repoGit()
  const g = await runCodefoxGate(wt, 'base-que-nao-existe', 'objetivo qualquer', '')
  expect(g.verdict).not.toBe('APPROVED')
  expect(g.ok).toBe(false)
  expect(g.reason).toContain('nao consegui LER o diff')
})

// O fixture PRECISA de um remoto `origin` de verdade. Sem ele, `syncWithBase` para
// na guarda de fetch e o laco de conflito nunca roda: os dois testes de REGRESSAO
// abaixo passavam sem exercitar nada, porque a unica assercao era `r.ok === false`
// — e `ok` era false pelo fetch, nao pelo marcador de conflito.
function repoComConflitoReal(): string {
  const wt = repoGit()
  const git = (...args: string[]): void => { execFileSync('git', args, { cwd: wt }) }
  const origem = dirTemp('hicode-aud-origem-')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main'], { cwd: origem })
  git('remote', 'add', 'origin', origem)
  git('push', '-q', 'origin', 'main')

  git('checkout', '-q', '-b', 'trabalho')
  writeFileSync(join(wt, 'a.txt'), 'versao do card\n')
  git('add', '-A')
  git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'card')

  // A base avanca NO REMOTO, que e o que syncWithBase busca.
  git('checkout', '-q', 'main')
  writeFileSync(join(wt, 'a.txt'), 'versao da base\n')
  git('add', '-A')
  git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'base')
  git('push', '-q', 'origin', 'main')
  git('checkout', '-q', 'trabalho')
  return wt
}

function temMarcadorDeConflito(wt: string): boolean {
  return /^(<{7}|={7}|>{7})/m.test(readFileSync(join(wt, 'a.txt'), 'utf8'))
}

const passoQueDizQueResolveu = async (): Promise<{ ok: boolean; text: string; cost: number; tokens: number; costMeasured: boolean; time: number }> =>
  ({ ok: true, text: 'resolvi', cost: 0, tokens: 0, costMeasured: true, time: 0 })

test('REGRESSAO agente que NAO tirou os marcadores nao faz o conflito passar como resolvido', async () => {
  const wt = repoComConflitoReal()
  let chamadas = 0
  let viuMarcador = false
  const dizQueResolveu = async (): ReturnType<typeof passoQueDizQueResolveu> => {
    chamadas++
    // O marcador tem de existir NO MOMENTO em que o agente e chamado. Conferir
    // depois nao serve: ao esgotar as tentativas o sync faz `merge --abort` e os
    // marcadores desaparecem.
    if (temMarcadorDeConflito(wt)) viuMarcador = true
    return passoQueDizQueResolveu()
  }
  const r = await syncWithBase('999', wt, 'main', wt, 'objetivo', {}, dizQueResolveu as unknown as typeof import('../../motor/ciclo/agente.ts').runStep)
  expect(r.ok).toBe(false)
  // As assercoes que provam que o LACO rodou de verdade — sem elas o teste passava
  // pela guarda de fetch, com o laco e o arquivosComMarcador inteiramente mortos.
  expect(chamadas, 'o agente de conflito nem foi chamado: o teste nao exercitou o laco').toBeGreaterThan(0)
  expect(viuMarcador, 'o agente foi chamado sem conflito de verdade no worktree').toBe(true)
  expect(r.detail, 'o motivo nao pode vir vazio').toBeTruthy()
})

test('REGRESSAO agente que NAO executou nao faz o conflito passar como resolvido', async () => {
  const wt = repoComConflitoReal()
  const naoExecutou = async (): Promise<{ ok: boolean; text: string; cost: number; tokens: number; costMeasured: boolean; time: number }> =>
    ({ ok: false, text: 'provider nao-agentico — step NAO executou', cost: 0, tokens: 0, costMeasured: true, time: 0 })
  let chamadas = 0
  const contando = async (): ReturnType<typeof naoExecutou> => { chamadas++; return naoExecutou() }
  const r = await syncWithBase('998', wt, 'main', wt, 'objetivo', {}, contando as unknown as typeof import('../../motor/ciclo/agente.ts').runStep)
  expect(chamadas, 'o agente nem foi chamado: o teste nao exercitou o laco').toBeGreaterThan(0)
  expect(r.ok).toBe(false)
})

test('REGRESSAO env numerico invalido nao vira NaN em silencio', () => {
  process.env.HICODE_TESTE_NUM = 'auto'
  expect(numeroDeEnv('HICODE_TESTE_NUM', 3)).toBe(3)
  process.env.HICODE_TESTE_NUM = '-5'
  expect(numeroDeEnv('HICODE_TESTE_NUM', 3)).toBe(3)
  process.env.HICODE_TESTE_NUM = '8'
  expect(numeroDeEnv('HICODE_TESTE_NUM', 3)).toBe(8)
  delete process.env.HICODE_TESTE_NUM
  expect(numeroDeEnv('HICODE_TESTE_NUM', 3)).toBe(3)
})

const consulta = (servidores: ServidorMcp[], escopos: Record<string, 'dinamico' | 'persistente' | 'nao-verificavel'>): ConsultaMcp => ({
  servidores: async () => ({ servidores, falhou: '' }),
  escopo: async (nome) => ({ escopo: escopos[nome] ?? 'persistente', falhou: '' }),
  prefixo: (nome) => `mcp__${nome.replace(/[^a-zA-Z0-9]+/g, '_')}`,
})

test('REGRESSAO conector cujo escopo NAO deu para verificar e tratado como indisponivel', async () => {
  const r = await disponibilidadeExterna('notion',
    consulta([{ nome: 'notion', estado: 'conectado' }], { notion: 'nao-verificavel' }))
  expect(r.usavel).toBe(false)
  expect(r.motivo).toContain('nao consegui verificar')
  expect(r.motivo).not.toContain('sessao interativa')
  expect(r.tools).toEqual([])
})

test('escopo dinamico continua com o motivo proprio, diferente de nao-verificavel', async () => {
  const r = await disponibilidadeExterna('notion',
    consulta([{ nome: 'notion', estado: 'conectado' }], { notion: 'dinamico' }))
  expect(r.usavel).toBe(false)
  expect(r.motivo).toContain('sessao interativa')
})

// O caso original: merge que falha por motivo que NAO e conflito (mudanca local
// nao commitada) caia no laco de conflito, `--diff-filter=U` vinha vazio, e o
// agente era chamado — PAGO — com "Resolva os conflitos nestes arquivos: " vazio,
// ate MAX_CONFLICT vezes, terminando com o diario afirmando um conflito que nunca
// existiu.
test('REGRESSAO merge que falha SEM conflito nao paga chamada de agente com lista vazia', async () => {
  const wt = repoComConflitoReal()
  // Desfaz o commit do card e deixa a mudanca NAO COMMITADA: o git recusa o merge
  // antes de comecar, e nao ha arquivo em estado U.
  execFileSync('git', ['reset', '-q', '--mixed', 'HEAD~1'], { cwd: wt })
  let chamadas = 0
  const conta = async (): ReturnType<typeof passoQueDizQueResolveu> => { chamadas++; return passoQueDizQueResolveu() }
  const r = await syncWithBase('997', wt, 'main', wt, 'objetivo', {}, conta as unknown as typeof import('../../motor/ciclo/agente.ts').runStep)
  expect(r.ok).toBe(false)
  expect(chamadas, 'chamada paga com lista vazia e exatamente o que a guarda existe para evitar').toBe(0)
  expect(r.detail, 'o motivo tem de NOMEAR a causa, nao chamar de conflito').toContain('mudanca local')
  expect(r.detail, 'nao ha arquivo em conflito para pedir ao agente').toContain('nao ha arquivo em conflito')
})
