import { test, expect, afterAll, afterEach } from '../apoio/runner.ts'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { PacoteDeExecucao } from '../../motor/niemeyer/lucio/pacote-de-execucao.ts'

// A pasta do Claude entra no hash do pacote: um card aprovado antes de a pasta
// mudar volta a pedir aval. Sem pasta (Codex/Kimi/Ollama em todos os papeis) o
// hash tem de ser exatamente o de antes desta entrega.

const BASE = mkdtempSync(join(tmpdir(), 'hii-pacote-pasta-'))
process.env.HII_CARDS_DIR = join(BASE, 'cards')
mkdirSync(process.env.HII_CARDS_DIR, { recursive: true })
mkdirSync(join(BASE, 'projeto', '.hii'), { recursive: true })
execFileSync('git', ['init', '-q'], { cwd: join(BASE, 'projeto') })
execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--allow-empty', '-qm', 'fixture'], { cwd: join(BASE, 'projeto') })
process.env.HII_REPOS_FILE = join(BASE, 'repos.json')
writeFileSync(process.env.HII_REPOS_FILE, JSON.stringify([{ name: 'org/site', path: join(BASE, 'projeto') }]))
process.env.HII_PROJECT_MEMORY = 'off'

const PAPEIS_ENV = ['HII_IMPLEMENT_PROVIDER', 'HII_VERIFY_PROVIDER', 'HII_GATE_PROVIDER', 'HII_STEP_PROVIDER', 'HII_AI_PROVIDER']
const ANTES: Record<string, string | undefined> = Object.fromEntries(PAPEIS_ENV.map(k => [k, process.env[k]]))

const { hashDoPacote, montarPacote } = await import('../../motor/niemeyer/lucio/pacote-de-execucao.ts')
const { versaoDaPasta } = await import('../../motor/tomada/harness/pasta-do-claude.ts')
const { createCard, readCard } = await import('../../motor/cordel/store.ts')

function papeis(implement: string, verify: string, gate: string, step: string): void {
  process.env.HII_IMPLEMENT_PROVIDER = implement
  process.env.HII_VERIFY_PROVIDER = verify
  process.env.HII_GATE_PROVIDER = gate
  process.env.HII_STEP_PROVIDER = step
  delete process.env.HII_AI_PROVIDER
}

afterEach(() => {
  for (const k of PAPEIS_ENV) {
    const v = ANTES[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

const SEM_PASTA: Omit<PacoteDeExecucao, 'hash'> = {
  versao: 1, id: '042', titulo: 'trocar o rodape', repo: 'org/site', modo: 'passivo',
  objetivo: 'trocar o rodape', ias: [{ papel: 'implement', provedor: 'claude', modelo: 'padrao do provedor' }],
  agentes: ['frontend'], skills: ['vue'], gates: ['crivo'], portoes: ['test: bun test'],
  acaoExterna: '', limites: 'teto US$ 5; gasto ate agora US$ 0.0000 e 0 tokens', avisoDeCota: '',
  prompt: 'implemente o rodape', memoria: '',
}

// Material do hash exatamente como era antes da pasta existir (mesma ordem de
// campos): e o que prova que o hash sem pasta nao mudou para cards ja aprovados.
function hashDeAntes(p: Omit<PacoteDeExecucao, 'hash'>): string {
  const material = {
    versao: p.versao, repo: p.repo, objetivo: p.objetivo, modo: p.modo,
    acaoExterna: p.acaoExterna, ias: p.ias, agentes: p.agentes,
    skills: p.skills, gates: p.gates, portoes: p.portoes,
    prompt: p.prompt,
    limites: p.limites.split(';')[0],
  }
  return createHash('sha256').update(JSON.stringify(material)).digest('hex').slice(0, 16)
}

test('pacote-pasta: pasta muda hash; sem pasta = hash de antes', () => {
  const comA = { ...SEM_PASTA, pasta: 'a' }
  const comB = { ...SEM_PASTA, pasta: 'b' }
  const vazia = { ...SEM_PASTA, pasta: '' }
  expect(hashDoPacote(comA)).not.toBe(hashDoPacote(comB))
  expect(hashDoPacote(comA)).not.toBe(hashDoPacote(SEM_PASTA))
  expect(hashDoPacote(vazia)).toBe(hashDoPacote(SEM_PASTA))
})

test('garantia: hash de pacote sem pasta igual ao de antes', () => {
  expect(hashDoPacote(SEM_PASTA)).toBe(hashDeAntes(SEM_PASTA))
  const vazia = { ...SEM_PASTA, pasta: '' }
  expect(hashDoPacote(vazia)).toBe(hashDeAntes(SEM_PASTA))
})

test('pacote-pasta: versaoDaPasta() e estavel entre duas chamadas e tem 16 caracteres hexadecimais', () => {
  const primeira = versaoDaPasta()
  const segunda = versaoDaPasta()
  expect(primeira).toMatch(/^[0-9a-f]{16}$/)
  expect(segunda).toBe(primeira)
})

test('pacote-pasta: versaoDaPasta muda com o conteudo de uma pasta temporaria', () => {
  const pasta = mkdtempSync(join(BASE, 'pasta-'))
  mkdirSync(join(pasta, 'comandos'), { recursive: true })
  writeFileSync(join(pasta, 'regras.md'), 'regra um\n')
  writeFileSync(join(pasta, 'comandos', 'hii-review.md'), '---\ndescription: "revisa"\n---\nrevise o diff\n')
  const v1 = versaoDaPasta(pasta)
  expect(v1).toMatch(/^[0-9a-f]{16}$/)
  expect(versaoDaPasta(pasta)).toBe(v1)

  const arquivo = join(pasta, 'comandos', 'hii-review.md')
  writeFileSync(arquivo, '---\ndescription: "revisa"\n---\nrevise o diff anexado com cuidado redobrado\n')
  const futuro = new Date(Date.now() + 5000)
  utimesSync(arquivo, futuro, futuro)
  const v2 = versaoDaPasta(pasta)
  expect(v2).toMatch(/^[0-9a-f]{16}$/)
  expect(v2).not.toBe(v1)
  // a pasta do motor nao e afetada pela pasta temporaria
  expect(versaoDaPasta()).not.toBe(v2)
})

function tarefa(titulo: string): string {
  return createCard({ title: titulo, status: 'EXECUTING', repo: 'org/site', motor_modo: 'passivo' }, `## Objetivo\n${titulo}\n`)
}

test('pacote-pasta: implement=codex com gate=claude mantem a pasta no hash', () => {
  papeis('codex', 'codex', 'claude', 'codex')
  const card = readCard(tarefa('gate no claude'))
  expect(card).not.toBeNull()
  if (!card) return
  const p = montarPacote(card)
  expect(p.pasta).toBe(versaoDaPasta())
  expect(p.hash).toBe(hashDoPacote(p))
  const semPasta = { ...p, pasta: '' }
  expect(p.hash).not.toBe(hashDoPacote(semPasta))
})

test('pacote-pasta: todos os papeis fora do Claude deixam o pacote sem pasta e o hash como antes', () => {
  papeis('codex', 'codex', 'kimi', 'codex')
  const card = readCard(tarefa('tudo fora do claude'))
  expect(card).not.toBeNull()
  if (!card) return
  const p = montarPacote(card)
  expect(p.pasta ?? '').toBe('')
  expect(p.hash).toBe(hashDeAntes(p))
})

test('pacote-pasta: implement=claude leva a pasta', () => {
  papeis('claude', 'codex', 'codex', 'codex')
  const card = readCard(tarefa('implement no claude'))
  if (!card) throw new Error('card nao criado')
  expect(montarPacote(card).pasta).toBe(versaoDaPasta())
})
