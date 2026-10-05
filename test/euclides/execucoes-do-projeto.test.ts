import { test, expect, afterAll, afterEach } from '../apoio/runner.ts'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const BASE = mkdtempSync(join(tmpdir(), 'hii-pacote-'))
process.env.HII_CARDS_DIR = join(BASE, 'cards')
mkdirSync(process.env.HII_CARDS_DIR, { recursive: true })
mkdirSync(join(BASE, 'projeto', '.hii'), { recursive: true })
execFileSync('git', ['init', '-q'], { cwd: join(BASE, 'projeto') })
writeFileSync(join(BASE, 'projeto', '.hii', 'rules.md'), 'Use Vue 3 com Composition API.\n')
execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--allow-empty', '-qm', 'fixture'], { cwd: join(BASE, 'projeto') })
process.env.HII_REPOS_FILE = join(BASE, 'repos.json')
writeFileSync(process.env.HII_REPOS_FILE, JSON.stringify([{ name: 'org/site', path: join(BASE, 'projeto') }]))

const { createCard, readCard } = await import('../../motor/cordel/store.ts')
const { liberarPeloPacote, definirIaDoCard, iasDoCard } = await import('../../motor/niemeyer/lucio/aprovacao-do-pacote.ts')
const { montarPacote } = await import('../../motor/niemeyer/lucio/pacote-de-execucao.ts')
const { pendencia, responder } = await import('../../motor/mirante/responder.ts')

afterEach(() => { delete process.env.HII_PROMPT_PRIMEIRO })
afterAll(() => rmSync(BASE, { recursive: true, force: true }))

function tarefa(titulo = 'trocar os icones do rodape'): string {
  return createCard({ title: titulo, status: 'EXECUTING', repo: 'org/site', motor_modo: 'passivo' }, `## Objetivo\n${titulo}\n`)
}

test('antes de qualquer IA, a tarefa para com o pacote para revisao', () => {
  const id = tarefa()
  expect(liberarPeloPacote(id)).toBe(false)
  const fm = readCard(id)?.fm
  expect(fm?.status).toBe('CLARIFY')
  expect(fm?.pacote_status).toBe('aguardando')
  const md = readFileSync(fm?.pacote_arquivo ?? '', 'utf8')
  expect(md).toContain('## Prompt do implementador')
  expect(md).toContain('trocar os icones do rodape')
  expect(md).toContain('Use Vue 3 com Composition API.')
  expect(md).toContain('## Gates do pipeline')
  expect(md).toContain('## IA por papel')
  expect(existsSync(join(BASE, 'projeto', '.hii', 'memory'))).toBe(true)
  expect(existsSync(join(BASE, 'projeto', 'CLAUDE.md'))).toBe(true)
})

test('a pergunta do pacote aparece no canal de perguntas', () => {
  const id = tarefa()
  liberarPeloPacote(id)
  const p = pendencia(id)
  expect(p?.origem).toBe('pacote')
  expect(p?.atual.options).toEqual(['Aprovar e executar', 'Cancelar a tarefa'])
  expect(p?.atual.q).toContain('IA que implementa')
})

test('aprovar libera a execucao, e o mesmo pacote nao pergunta de novo', () => {
  const id = tarefa()
  liberarPeloPacote(id)
  const r = responder(id, '1')
  expect(r.retomou).toBe(true)
  const fm = readCard(id)?.fm
  expect(fm?.status).toBe('EXECUTING')
  expect(fm?.pacote_aprovado_hash).toBe(fm?.pacote_hash)
  expect(liberarPeloPacote(id)).toBe(true)
})

test('texto livre ajusta o pedido e gera pacote novo antes de executar', () => {
  const id = tarefa()
  liberarPeloPacote(id)
  const hashAntes = readCard(id)?.fm.pacote_hash
  responder(id, 'use icones de linha, nao preenchidos')
  expect(readCard(id)?.fm.status).toBe('EXECUTING')
  expect(liberarPeloPacote(id)).toBe(false)
  const fm = readCard(id)?.fm
  expect(fm?.pacote_hash).not.toBe(hashAntes)
  expect(readFileSync(fm?.pacote_arquivo ?? '', 'utf8')).toContain('use icones de linha, nao preenchidos')
})

test('cancelar para a tarefa como parada humana', () => {
  const id = tarefa()
  liberarPeloPacote(id)
  responder(id, '2')
  const fm = readCard(id)?.fm
  expect(fm?.status).toBe('HALTED')
  expect(fm?.halt_class).toBe('humano')
})

test('HII_PROMPT_PRIMEIRO=off mantem o despacho direto', () => {
  process.env.HII_PROMPT_PRIMEIRO = 'off'
  const id = tarefa()
  expect(liberarPeloPacote(id)).toBe(true)
  expect(readCard(id)?.fm.status).toBe('EXECUTING')
})

test('a IA escolhida para o card atualiza a identidade do pacote para revisao', () => {
  const id = tarefa()
  liberarPeloPacote(id)
  const hash = readCard(id)?.fm.pacote_hash
  expect(definirIaDoCard(id, { papel: 'implement', provedor: 'codex', modelo: 'modelo-x' }).ok).toBe(true)
  const fm = readCard(id)?.fm
  expect(fm?.provider_override_implement).toBe('codex')
  expect(fm?.pacote_hash).not.toBe(hash)
  expect(fm?.pacote_resumo).toContain('codex (modelo-x)')
  expect(iasDoCard(fm ?? {}).find(i => i.papel === 'implement')?.provedor).toBe('codex')
  const pacote = montarPacote(readCard(id)!)
  expect(pacote.ias.find(i => i.papel === 'implement')?.provedor).toBe('codex')
})

test('IA desconhecida ou papel invalido sao recusados', () => {
  const id = tarefa()
  expect(definirIaDoCard(id, { papel: 'implement', provedor: 'ia-que-nao-existe' }).ok).toBe(false)
  expect(definirIaDoCard(id, { papel: 'faxina', provedor: 'codex' }).ok).toBe(false)
  expect(existsSync(join(BASE, 'cards', 'pacotes', `${id}.md`))).toBe(false)
})

test('tarefa que ja comecou antes da atualizacao nao volta para aprovacao', () => {
  const id = createCard({ title: 'em voo', status: 'EXECUTING', repo: 'org/site', worktree: '/tmp/wt-qualquer', cost_usd: '1.2' }, '## Objetivo\nem voo\n')
  expect(liberarPeloPacote(id)).toBe(true)
  expect(readCard(id)?.fm.status).toBe('EXECUTING')
})

test('a pergunta do pacote aparece no estado lido pela TUI e pelo painel', async () => {
  const { snapshotDoMotor } = await import('../../motor/mirante/estado-json.ts')
  const id = tarefa('pergunta no estado')
  liberarPeloPacote(id)
  const t = snapshotDoMotor().tarefas.find(x => x.id === id)
  expect(t?.pergunta?.opcoes).toEqual(['Aprovar e executar', 'Cancelar a tarefa'])
})

test('a IA escolhida pelo humano sobrevive a uma parada por falha', async () => {
  const { applyFailurePolicy } = await import('../../motor/ciclo/reprise/politica.ts')
  const id = tarefa('parada mantem a escolha')
  expect(definirIaDoCard(id, { papel: 'implement', provedor: 'codex' }).ok).toBe(true)
  applyFailurePolicy({ id, fromStatus: 'EXECUTING', resumeStatus: 'EXECUTING', provider: 'codex', papel: 'implement', failureClass: 'terminal', failureReason: 'quebrou', technicalDetail: '' })
  const fm = readCard(id)?.fm
  expect(fm?.status).toBe('HALTED')
  expect(fm?.provider_override_implement).toBe('codex')
})

test('troca automatica do roteador continua limpa na parada', async () => {
  const { applyFailurePolicy } = await import('../../motor/ciclo/reprise/politica.ts')
  const id = createCard({ title: 'rota automatica', status: 'EXECUTING', repo: 'org/site', provider_override_implement: 'kimi' }, '## Objetivo\nx\n')
  applyFailurePolicy({ id, fromStatus: 'EXECUTING', resumeStatus: 'EXECUTING', provider: 'kimi', papel: 'implement', failureClass: 'terminal', failureReason: 'quebrou', technicalDetail: '' })
  expect(readCard(id)?.fm.provider_override_implement ?? '').toBe('')
})

test('mudanca de regras depois da exibicao impede aprovacao de prompt antigo', () => {
  const id = tarefa('regras precisam de validacao')
  liberarPeloPacote(id)
  const arquivo = join(BASE, 'projeto', '.hii', 'rules.md')
  const original = readFileSync(arquivo, 'utf8')
  try {
    writeFileSync(arquivo, original + 'Nao alterar banco de dados.\n')
    const resposta = responder(id, '1')
    expect(resposta.ok).toBe(false)
    expect(readCard(id)?.fm.status).toBe('CLARIFY')
    expect(readCard(id)?.fm.pacote_aprovado_hash ?? '').toBe('')
    expect(readFileSync(readCard(id)?.fm.pacote_arquivo ?? '', 'utf8')).toContain('Nao alterar banco')
    expect(responder(id, '1').retomou).toBe(true)
  } finally { writeFileSync(arquivo, original) }
})
