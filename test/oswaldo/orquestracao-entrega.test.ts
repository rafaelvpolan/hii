import { test, beforeEach, afterEach } from '../apoio/runner.ts'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCard, patchCard, readCard } from '../../motor/cordel/store.ts'
import { salvarPlano } from '../../motor/oswaldo/orquestracao/planos.ts'
import { coletarEvidencias, arquivoDeEvidencias } from '../../motor/oswaldo/orquestracao/evidencias.ts'
import { certificarEntrega } from '../../motor/oswaldo/orquestracao/entrega.ts'
import { avaliarExecucao } from '../../motor/api/avaliacao.ts'
import { planoOrquestrado } from '../fixtures/plano-orquestrado.ts'
import type { run } from '../../motor/quilombo/git.ts'
let base = '', wt = '', id = '', head = '', tree = ''
let env: NodeJS.ProcessEnv
const pr = 'https://github.com/org/app/pull/7'
const merge = 'a'.repeat(40)
const git = (...args: string[]): string => execFileSync('git', args, { cwd: wt, encoding: 'utf8' }).trim()
beforeEach(async () => {
  env = { ...process.env }
  base = mkdtempSync(join(tmpdir(), 'hii-entrega-')); wt = join(base, 'wt')
  mkdirSync(wt)
  process.env.HII_CARDS_DIR = join(base, 'cards')
  git('init', '-q')
  writeFileSync(join(wt, 'produto.txt'), 'resultado aprovado\n')
  git('add', '.')
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'produto')
  head = git('rev-parse', 'HEAD'); tree = git('rev-parse', 'HEAD^{tree}')
  id = createCard({ repo: 'org/app', desc: 'Entrega verificavel', status: 'CLEANED', motor_modo: 'passivo', worktree: wt }, '')
  const plano = salvarPlano({ ...planoOrquestrado(), id, sessaoId: id }, 0, 'entrega')
  patchCard(id, { plano_revisao: '1', plano_hash: plano.hash, pushed_sha: head })
  await coletarEvidencias(plano.plano, 1, wt)
})
afterEach(() => { process.env = env; rmSync(base, { recursive: true, force: true }) })
function remoto(state = 'OPEN', sha = head, arvore = tree): typeof run {
  return async (_bin, args) => ({
    stdout: JSON.stringify(args[0] === 'pr' ? { url: pr, state, headRefOid: sha, mergeCommit: state === 'MERGED' ? { oid: merge } : null } : { sha: merge, tree: { sha: arvore } }),
    stderr: '', err: null,
  })
}
async function entregar(): Promise<string> {
  const digest = await certificarEntrega(id, wt, head, pr)
  patchCard(id, { entrega_evidencia: digest, pr_url: pr, status: 'PR_OPEN' })
  rmSync(wt, { recursive: true, force: true })
  return digest
}
test('entrega sobrevive sem worktree e sem ponteiro de evidencia; merge exige mesma arvore', async () => {
  const digest = await certificarEntrega(id, wt, head, pr)
  assert.equal(await certificarEntrega(id, wt, head, pr), digest, 'retry preserva certificado identico')
  assert.equal(readdirSync(join(base, 'cards', 'entregas')).length, 1)
  await entregar()
  rmSync(arquivoDeEvidencias(id, 1))
  const a = await avaliarExecucao(id, remoto())
  assert.equal(a.criteriosAprovados, true)
  assert.deepEqual(a.entrega, { head, tree, pr, merge: null })
  patchCard(id, { status: 'MERGED' })
  const integrada = await avaliarExecucao(id, remoto('MERGED'))
  assert.equal(integrada.criteriosAprovados, true)
  assert.equal(integrada.entrega?.merge, merge)
  assert.equal((await avaliarExecucao(id, remoto('MERGED', head, 'b'.repeat(40)))).criteriosAprovados, false)
})
test('push posterior, PR fechado, remoto ausente e resposta invalida preservam inconclusao', async () => {
  await entregar()
  for (const executar of [remoto('OPEN', 'b'.repeat(40)), remoto('CLOSED'), remoto('MERGED'),
    (async () => { throw new Error('sem rede') }) as typeof run,
    (async () => ({ stdout: '{}', stderr: '', err: null })) as typeof run]) {
    const a = await avaliarExecucao(id, executar)
    assert.equal(a.criteriosAprovados, false)
    assert.equal(a.criterios[0]?.estado, 'inconclusivo')
    assert.equal(a.criterios[0]?.resultadoRegistrado, 'aprovado')
    assert.equal(a.entrega, undefined)
  }
})
test('certificado adulterado, plano ou commit divergente nao aprovam', async () => {
  const digest = await entregar()
  patchCard(id, { pushed_sha: 'b'.repeat(40) })
  assert.equal((await avaliarExecucao(id, remoto())).atualidade, 'inconsistente')
  patchCard(id, { pushed_sha: head })
  const arquivo = join(base, 'cards', 'entregas', id + '-1-' + digest + '.json')
  writeFileSync(arquivo, readFileSync(arquivo, 'utf8').replace('produto', 'adulterado'))
  // Uma alteracao byte a byte, inclusive apenas whitespace, quebra o digest.
  writeFileSync(arquivo, readFileSync(arquivo, 'utf8') + '\n')
  assert.equal((await avaliarExecucao(id, remoto())).atualidade, 'inconsistente')
})
test('alteracao nao commitada ou criterio sem prova impede certificar e preserva worktree', async () => {
  writeFileSync(join(wt, 'novo.txt'), 'nao enviado')
  await assert.rejects(() => certificarEntrega(id, wt, head, pr), /nao commitadas/)
  rmSync(join(wt, 'novo.txt'))
  await assert.rejects(() => certificarEntrega(id, wt, 'b'.repeat(40), pr), /diverge/)
  const arquivo = arquivoDeEvidencias(id, 1)
  const r = JSON.parse(readFileSync(arquivo, 'utf8'))
  r.evidencias[0].estado = 'inconclusivo'
  writeFileSync(arquivo, JSON.stringify(r))
  await assert.rejects(() => certificarEntrega(id, wt, head, pr), /criterios/)
  assert.equal(readFileSync(join(wt, 'produto.txt'), 'utf8'), 'resultado aprovado\n')
})
test('consulta concorrente com parada humana ou revisao nova nao promove evidencia', async () => {
  await entregar()
  const executar: typeof run = async (...args) => {
    patchCard(id, { status: 'HALTED' })
    return remoto()(...args)
  }
  const a = await avaliarExecucao(id, executar)
  assert.equal(a.atualidade, 'desatualizada')
  assert.equal(a.criteriosAprovados, false)
  assert.equal(readCard(id)?.fm.status, 'HALTED')
})
