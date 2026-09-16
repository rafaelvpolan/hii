import { test, expect, beforeEach, afterEach } from '../apoio/runner.ts'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { tui } from '../../bin/repl.ts'
import type { Terminal } from '../../motor/mirante/tui/screen.ts'
import { newSession, seguir, perguntando } from '../../motor/mirante/sessao.ts'
import { dispatchIOFalso } from '../fixtures/dispatch-io-falso.ts'
import { telaVirtual } from '../fixtures/tela-virtual.ts'
import { submit, submitSession } from '../../motor/mirante/acoes.ts'
import { allCards, readCard, patchCard } from '../../motor/cordel/store.ts'
import { criarExecucao } from '../../motor/mirante/criar-execucao.ts'
import { lerSessaoHii, fecharSessaoHii } from '../../motor/euclides/sessoes.ts'
import { writeClarify, readClarify } from '../../motor/agentes/clarice/clarificar.ts'
import { executarGateway } from '../../motor/oswaldo/gateway.ts'
import { harnessPorNome, providerNames, modoFor } from '../../motor/tomada/registro.ts'
import { aplicar } from '../../motor/tomada/escolha-de-ia.ts'
import { gravarChamadaNoLiveLog } from '../../motor/tomada/harness/live-log.ts'
import { selecionar, definirSessoesVisiveis } from '../../motor/mirante/cli/estado.ts'
import { chamadasEmVoo } from '../../motor/euclides/linha-do-tempo.ts'
import { linhaDoTempoDe } from '../../motor/mirante/cli/dados.ts'

let base = ''
let env: NodeJS.ProcessEnv
let dimensoes: { cols: number; rows: number }
const restaurar: (() => void)[] = []
beforeEach(() => {
  env = { ...process.env }
  dimensoes = { cols: process.stdout.columns, rows: process.stdout.rows }
  base = mkdtempSync(join(tmpdir(), 'hii-tui-integrado-'))
  for (const d of ['cards', 'bin', 'alvo', 'outro', 'codex', 'skills', 'agents']) mkdirSync(join(base, d))
  process.env.HII_CARDS_DIR = join(base, 'cards')
  process.env.HII_IA_FILE = join(base, 'ia.json')
  process.env.HII_REPOS_FILE = join(base, 'repos.json')
  process.env.HII_MODELOS_FILE = join(base, 'modelos.json')
  process.env.HII_SKILLS_DIR = join(base, 'skills')
  process.env.HII_AGENTS_DIR = join(base, 'agents')
  process.env.CODEX_HOME = join(base, 'codex')
  process.env.HII_QUOTA_FALLBACK = 'on'
  process.env.HII_CLAUDE_CONFIG = join(base, 'claude.json')
  process.env.PATH = `${join(base, 'bin')}:${env.PATH}`
  writeFileSync(process.env.HII_REPOS_FILE, JSON.stringify([
    { name: 'org/app', path: join(base, 'alvo'), branch: 'main' },
    { name: 'org/outro', path: join(base, 'outro'), branch: 'main' },
  ]))
  writeFileSync(process.env.HII_MODELOS_FILE, JSON.stringify({ codex: ['modelo-teste'] }))
  for (const nome of providerNames()) {
    const h = harnessPorNome(nome)
    const autenticado = h.autenticado
    const run = h.run
    h.autenticado = () => nome === 'codex' || nome === 'claude'
    if (nome !== 'codex') h.run = async () => { throw new Error(`IA real proibida neste teste: ${nome}`) }
    restaurar.push(() => { h.autenticado = autenticado; h.run = run })
  }
  selecionar('')
  definirSessoesVisiveis([])
})
afterEach(() => {
  for (const f of restaurar.splice(0)) f()
  process.env = env
  process.stdout.columns = dimensoes.cols
  process.stdout.rows = dimensoes.rows
  rmSync(base, { recursive: true, force: true })
})

function terminal(cols = 100) {
  process.stdout.columns = cols
  process.stdout.rows = 36
  const saida: string[] = []
  let ler = (_s: string): void => {}
  const term: Terminal = { write: s => { saida.push(s) }, cols: () => cols, rows: () => 36, setRaw: () => {},
    onKey: f => { ler = f }, offKey: () => { ler = () => {} }, onResize: () => {}, offResize: () => {} }
  return { term, tela: () => telaVirtual(saida, cols), tecla: (s: string) => ler(s),
    linha: (s: string) => { for (const c of s) ler(c); ler('\r') } }
}

async function ate(condicao: () => boolean, detalhe: () => string): Promise<void> {
  const prazo = Date.now() + 4000
  while (!condicao() && Date.now() < prazo) await new Promise(r => setTimeout(r, 20))
  expect(condicao(), detalhe()).toBe(true)
}

function io(app: { log: (s: string) => void }) {
  return dispatchIOFalso({ log: app.log, responder: async () => ['resposta sem executar'], daemonOnline: () => true })
}

async function sair(t: ReturnType<typeof terminal>, fim: Promise<void>) {
  t.tecla('\x1b')
  t.tecla('\x04')
  await fim
}

for (const cols of [48, 100]) test(`TUI real ${cols}: Codex transmite, falha por cota, roteia e termina na mesma session`, async () => {
  const script = join(base, 'bin', 'codex')
  writeFileSync(script, `#!/bin/sh
printf '%s\\n' '{"type":"item.completed","item":{"type":"agent_message","text":"CODEx iniciou o trabalho"}}'
printf '%s' parcial > parcial.txt
sleep 1
printf '%s\\n' '{"type":"turn.failed","error":{"message":"usage limit reached: weekly limit"}}'
exit 1
`)
  chmodSync(script, 0o755)
  aplicar({ papeis: ['implement'], provider: 'codex', model: 'modelo-teste' })
  let liberar = (): void => {}
  const pausa = new Promise<void>(r => { liberar = r })
  let recebeuContexto = false
  harnessPorNome('claude').run = async req => {
    recebeuContexto = req.prompt.includes('Preserve a API publica') && req.prompt.includes('Continue do estado atual')
    expect(readFileSync(join(req.cwd, 'parcial.txt'), 'utf8')).toBe('parcial')
    gravarChamadaNoLiveLog({ caminho: req.liveLog!, rotulo: req.rotulo, linhas: ['Claude continuou o trabalho'] })
    await pausa
    return { ok: true, failed: false, timedOut: false, isError: false, detail: '', text: 'API preservada', cost: 0,
      costMeasured: false, usage: { tokens_in: 4, tokens_out: 2, tokens_cache_create: 0, tokens_cache_read: 0 } }
  }
  const t = terminal(cols)
  const fim = tui(newSession('org/app'), t.term, io)
  let execucao: Promise<void> | undefined
  try {
    t.linha('/new conversa')
    await ate(() => allCards().length === 1, t.tela)
    const sessao = allCards()[0]!.id!
    t.linha('Preserve a API publica')
    await ate(() => (lerSessaoHii(sessao)?.execucoes.length ?? 0) === 1, t.tela)
    const id = lerSessaoHii(sessao)!.execucoes[0]!.id
    execucao = executarGateway(id)
    await ate(() => t.tela().includes('CODEx iniciou o trabalho'), t.tela)
    expect(readCard(id)?.fm.status).toBe('EXECUTING')
    await ate(() => recebeuContexto, () => JSON.stringify(readCard(id)?.fm))
    await ate(() => t.tela().includes('mudando automaticamente para claude'), t.tela)
    const tela = t.tela()
    expect(tela).toContain('IA codex falhou')
    expect(tela.indexOf('IA codex falhou')).toBeLessThan(tela.indexOf('mudando automaticamente'))
    liberar()
    await execucao
    await ate(() => t.tela().includes('concluido') && t.tela().includes('nada em execucao'), t.tela)
    expect(readCard(id)?.fm.status).toBe('COMPLETED')
    expect(lerSessaoHii(sessao)?.subsessoes.map(s => s.provedor)).toEqual(['codex', 'claude'])
    expect(chamadasEmVoo(linhaDoTempoDe(id))).toEqual([])
    expect(t.tela()).not.toContain('error()')
    t.linha('/ask como ficou?')
    await ate(() => t.tela().includes('resposta sem executar'), t.tela)
    expect(lerSessaoHii(sessao)?.execucoes.length).toBe(1)
    t.linha('Agora ajuste o texto')
    await ate(() => lerSessaoHii(sessao)?.execucoes.length === 2, t.tela)
    expect(allCards().filter(c => c.tipo === 'session').length).toBe(1)
  } finally { liberar(); try { await execucao } finally { await sair(t, fim) } }
}, 15000)

test('CLARIFY surgindo durante a execucao aparece e o numero responde sem Enter', async () => {
  const id = submit({ title: 'clarificar', repo: 'org/app' })
  patchCard(id, { status: 'EXECUTING' })
  const t = terminal()
  const fim = tui(seguir(newSession('org/app'), id), t.term, io)
  try {
    writeClarify(id, [{ q: 'Qual cor aplicar?', options: ['azul', 'verde'], recommended: 'azul' }])
    patchCard(id, { status: 'CLARIFY' })
    await ate(() => t.tela().includes('Qual cor aplicar?'), t.tela)
    t.tecla('2')
    await ate(() => readCard(id)?.fm.status === 'EXECUTING', t.tela)
    expect(readClarify(id)[0]?.answer).toBe('verde')
  } finally { await sair(t, fim) }
})

test('Ctrl+C para a tarefa, Enter retoma e Esc sai do acompanhamento', async () => {
  const { id } = criarExecucao('org/app', '', 'parar e retomar')
  patchCard(id, { status: 'EXECUTING' })
  const t = terminal()
  const fim = tui(seguir(newSession('org/app'), id), t.term, io)
  try {
    t.tecla('\x03')
    expect(readCard(id)?.fm.status).toBe('HALTED')
    expect(t.tela()).toContain('retoma')
    t.tecla('\r')
    await ate(() => readCard(id)?.fm.status === 'EXECUTING', t.tela)
    await new Promise(r => setTimeout(r, 20))
    t.tecla('\x1b')
    await ate(() => t.tela().includes('SESSIONS'), t.tela)
    expect(readCard(id)?.fm.status).toBe('EXECUTING')
  } finally { await sair(t, fim) }
})

test('numero da tarefa abre CLARIFY pendente sem aprovar plano nem criar outra tarefa', async () => {
  const id = submit({ title: 'pergunta pendente', repo: 'org/app' })
  patchCard(id, { status: 'CLARIFY' })
  writeClarify(id, [{ q: 'Qual variante?', options: ['A', 'B'], recommended: 'A' }])
  const t = terminal()
  const fim = tui(newSession('org/app'), t.term, io)
  try {
    t.linha(String(Number(id)))
    await ate(() => t.tela().includes('Qual variante?'), t.tela)
    expect(readCard(id)?.fm.status).toBe('CLARIFY')
    t.tecla('2')
    await ate(() => readCard(id)?.fm.status === 'EXECUTING', t.tela)
    expect(readClarify(id)[0]?.answer).toBe('B')
    expect(allCards().length).toBe(1)
  } finally { await sair(t, fim) }
})

test('/hii spec e texto comum mantem modos distintos na mesma session; falha nao cria pedido', async () => {
  writeFileSync(join(base, 'alvo', 'tarefa.spec'), '# Requisitos\nPreserve a API\n## Criterios\nAdicionar teste\n')
  const t = terminal()
  const fim = tui(newSession('org/app'), t.term, io)
  try {
    t.linha('/hii tarefa.spec')
    await ate(() => allCards().some(c => c.motor_modo === 'passivo'), t.tela)
    const primeira = allCards().find(c => c.motor_modo === 'passivo')!
    expect(readCard(primeira.id!)?.body).toContain('Adicionar teste')
    t.linha('Ajuste o texto da interface')
    await ate(() => lerSessaoHii(primeira.sessao_id!)?.execucoes.length === 2, t.tela)
    const segunda = lerSessaoHii(primeira.sessao_id!)!.execucoes[1]!.id
    expect(readCard(segunda)?.fm.motor_modo).toBe('gateway')
    t.linha('/hii ausente.spec')
    await ate(() => t.tela().includes('orquestrador:'), t.tela)
    expect(lerSessaoHii(primeira.sessao_id!)?.execucoes.length).toBe(2)
    expect(() => fecharSessaoHii(primeira.sessao_id!)).toThrow('pendente')
    for (const id of [primeira.id!, segunda]) patchCard(id, { status: 'HALTED', halt_class: 'humano' })
    fecharSessaoHii(primeira.sessao_id!)
    for (let i = 0; i < 20; i++) t.linha(`/ask consulta ${i}`)
    t.linha('/historico')
    await ate(() => t.tela().includes(`#${primeira.sessao_id} closed`), t.tela)
  } finally { await sair(t, fim) }
})

test('/ia e /model exibem catalogo navegavel; selecionar modelo e persistido', async () => {
  aplicar({ papeis: ['implement'], provider: 'codex' })
  const t = terminal()
  const fim = tui(newSession('org/app'), t.term, io)
  try {
    t.linha('/model')
    await ate(() => t.tela().includes('modelo-teste'), t.tela)
    t.linha('/model 1')
    await ate(() => t.tela().includes('implement: codex/modelo-teste'), t.tela)
    t.linha('/ia')
    await ate(() => t.tela().includes('/ia claude'), t.tela)
    let encontrou = t.tela().includes('[sem-cli]') || t.tela().includes('[ok]')
    for (let i = 0; i < 6 && !encontrou; i++) {
      t.tecla('\x1b[5~')
      encontrou = t.tela().includes('[sem-cli]') || t.tela().includes('[ok]')
    }
    expect(encontrou, t.tela()).toBe(true)
    expect(allCards().length).toBe(0)
  } finally { await sair(t, fim) }
})

test('CONFIRM aparece com acao de fechar, nao de repetir polimento', async () => {
  const id = submit({ title: 'confirmar entrega', repo: 'org/app' })
  patchCard(id, { status: 'EXECUTING' })
  patchCard(id, { status: 'URL' })
  patchCard(id, { status: 'URL_OK' })
  const t = terminal()
  const fim = tui(seguir(newSession('org/app'), id), t.term, io)
  try {
    patchCard(id, { status: 'CONFIRM', verify: 'sem-url' })
    await ate(() => t.tela().includes('encerrar e abrir o PR'), t.tela)
    expect(t.tela()).not.toContain('rodando — nada a fazer agora')
    expect(t.tela()).not.toContain('segue para o polimento')
    t.tecla('1')
    await ate(() => readCard(id)?.fm.fecho_confirmado === 'sim', t.tela)
    expect(readCard(id)?.fm.status).toBe('URL_OK')
  } finally { await sair(t, fim) }
})

test('/new abandona pendencias anteriores antes de aceitar um novo pedido', async () => {
  const id = submit({ title: 'antiga', repo: 'org/app' })
  patchCard(id, { status: 'HALTED' })
  const t = terminal()
  const fim = tui({ ...perguntando(seguir(newSession('org/app'), id), id), retomando: id, removendo: id }, t.term, io)
  try {
    t.linha('/new nova conversa')
    await ate(() => allCards().some(c => c.tipo === 'session'), t.tela)
    t.linha('Ajuste apenas o novo pedido')
    await ate(() => allCards().some(c => c.title === 'Ajuste apenas o novo pedido'), t.tela)
    expect(readCard(id)?.fm.status).toBe('HALTED')
  } finally { await sair(t, fim) }
})

test('Tab no board troca projeto sem manter a tarefa antiga como alvo', async () => {
  const sessao = submitSession({ title: 'app original', repo: 'org/app' })
  const { id } = criarExecucao('org/app', sessao, 'pedido original')
  patchCard(id, { status: 'EXECUTING' })
  patchCard(id, { status: 'COMPLETED' })
  const t = terminal()
  const fim = tui(seguir(newSession('org/app'), id), t.term, io)
  try {
    t.tecla('\x1b[D')
    t.tecla('\t')
    t.tecla('\x1b')
    t.linha('/ask de qual projeto?')
    await ate(() => t.tela().includes('resposta sem executar'), t.tela)
    expect(lerSessaoHii(sessao)?.mensagens.map(m => m.texto)).not.toContain('de qual projeto?')
  } finally { await sair(t, fim) }
})

test('Shift+Tab muda o modo do Codex e /config abre e fecha pelo teclado', async () => {
  aplicar({ papeis: ['implement'], provider: 'codex', modo: 'never' })
  const t = terminal()
  const fim = tui(newSession('org/app'), t.term, io)
  try {
    t.tecla('\x1b[Z')
    expect(modoFor('implement')).toBe('on-request')
    t.tecla('\x1b[Z')
    expect(modoFor('implement')).toBe('never')
    t.linha('/config')
    await ate(() => t.tela().includes('IAS'), t.tela)
    t.tecla('\x1b')
    t.linha('/new depois da config')
    await ate(() => allCards().some(c => c.title === 'depois da config'), t.tela)
  } finally { await sair(t, fim) }
})
