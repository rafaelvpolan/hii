import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { envolverComCassete } from '../apoio/cassete.ts'
import type { EntradaDoCassete, OpcoesDoCassete } from '../apoio/cassete.ts'
import type { Terminal } from '../../motor/mir/tui/screen.ts'
import { harnessPorNome } from '../../motor/tmd/registro.ts'
import type { AgentRequest, AgentResult, AgentRole, Harness, HarnessId } from '../../motor/tmd/tipos.ts'

export const REPO_NOME = 'org/repo'

export const BASE = mkdtempSync(join(tmpdir(), 'hii-tui-com-modelo-'))
const BIN = join(BASE, 'bin')
mkdirSync(BIN, { recursive: true })

const CLAUDE_FALSO = `#!/usr/bin/env bash
if [ "$1" = "mcp" ] && [ "$2" = "list" ]; then
  echo "nenhum servidor MCP configurado (fake de teste)"
  exit 0
fi
if [ "$1" = "mcp" ] && [ "$2" = "get" ]; then
  echo "  Scope: User config (fake de teste)"
  exit 0
fi
echo "claude falso de teste so responde mcp list/get — o resto vem do harness.run trocado em processo" >&2
exit 1
`
writeFileSync(join(BIN, 'claude'), CLAUDE_FALSO)
chmodSync(join(BIN, 'claude'), 0o755)

const PATH_ORIGINAL = process.env.PATH ?? ''
process.env.PATH = `${BIN}:${PATH_ORIGINAL}`

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

const origem = join(BASE, 'origem.git')
const semente = join(BASE, 'semente')
const clone = join(BASE, 'clone')
mkdirSync(semente, { recursive: true })
execFileSync('git', ['init', '-q', '--bare', origem])
git(semente, ['init', '-q', '.'])
git(semente, ['config', 'user.email', 't@t'])
git(semente, ['config', 'user.name', 't'])
writeFileSync(join(semente, 'a.txt'), 'um\n')
git(semente, ['add', '-A'])
git(semente, ['commit', '-qm', 'primeiro'])
git(semente, ['branch', '-M', 'main'])
git(semente, ['remote', 'add', 'origin', origem])
git(semente, ['push', '-q', '-u', 'origin', 'main'])
execFileSync('git', ['--git-dir', origem, 'symbolic-ref', 'HEAD', 'refs/heads/main'])
execFileSync('git', ['clone', '-q', origem, clone])
git(clone, ['config', 'user.email', 't@t'])
git(clone, ['config', 'user.name', 't'])

process.env.HICODE_CARDS_DIR = join(BASE, 'cards')
mkdirSync(process.env.HICODE_CARDS_DIR, { recursive: true })
mkdirSync(join(process.env.HICODE_CARDS_DIR, 'runs'), { recursive: true })
process.env.HICODE_REPOS_FILE = join(BASE, 'repos.json')
writeFileSync(process.env.HICODE_REPOS_FILE, JSON.stringify([{ name: REPO_NOME, path: clone, branch: 'main' }]))
process.env.HICODE_AGENTS_DIR = join(BASE, 'agentes-vazio')
mkdirSync(process.env.HICODE_AGENTS_DIR, { recursive: true })
process.env.HICODE_SKILLS_DIR = join(BASE, 'skills-vazio')
mkdirSync(process.env.HICODE_SKILLS_DIR, { recursive: true })
delete process.env.HICODE_AI_PROVIDER
delete process.env.HICODE_IMPLEMENT_PROVIDER
delete process.env.HICODE_VERIFY_PROVIDER
delete process.env.HICODE_GATE_PROVIDER
delete process.env.HICODE_STEP_PROVIDER
delete process.env.HICODE_EFFORT

export function limparAmbiente(): void {
  process.env.PATH = PATH_ORIGINAL
  delete process.env.HICODE_CARDS_DIR
  delete process.env.HICODE_REPOS_FILE
  delete process.env.HICODE_AGENTS_DIR
  delete process.env.HICODE_SKILLS_DIR
  delete process.env.HICODE_IA_FILE
  rmSync(BASE, { recursive: true, force: true })
}

export function usarArquivoDeIa(nome: string): void {
  process.env.HICODE_IA_FILE = join(BASE, `${nome}.json`)
}

export function novoDirDeCassete(nome: string): string {
  return join(BASE, `cassetes-${nome}`)
}

export function agentResultDe(texto: string, custo: number, tokensIn: number, tokensOut: number): AgentResult {
  return {
    ok: true,
    failed: false,
    timedOut: false,
    isError: false,
    detail: '',
    text: texto,
    cost: custo,
    costMeasured: true,
    usage: { tokens_in: tokensIn, tokens_out: tokensOut, tokens_cache_create: 0, tokens_cache_read: 0 },
  }
}

function harnessSintetico(base: Harness, binarioFalso: string, resolver: (req: AgentRequest) => AgentResult | Promise<AgentResult>): Harness {
  return {
    name: base.name,
    supportsAgents: base.supportsAgents,
    supportsVision: base.supportsVision,
    agentic: base.agentic,
    modos: base.modos,
    cor: base.cor,
    binario: binarioFalso,
    exigeCliNoPath: false,
    comandoDeLogin: base.comandoDeLogin,
    rodaLocal: base.rodaLocal,
    temLeitorDePlano: base.temLeitorDePlano,
    capabilities: () => base.capabilities(),
    healthCheck: () => base.healthCheck(),
    sinaisDeFalha: () => base.sinaisDeFalha(),
    comoObterQuandoAusente: () => base.comoObterQuandoAusente(),
    autenticado: () => base.autenticado(),
    plano: (agoraMs: number) => base.plano(agoraMs),
    modelosDisponiveis: () => base.modelosDisponiveis(),
    prontoParaUso: () => base.prontoParaUso(),
    modeloPadraoPara: (papel: AgentRole) => base.modeloPadraoPara(papel),
    run: (req: AgentRequest): Promise<AgentResult> => Promise.resolve(resolver(req)),
  }
}

export interface HarnessInstalado {
  restaurar(): void
  caminhoDoCassete: string
}

export function instalarHarnessDoCassete(nome: HarnessId, resolver: (req: AgentRequest) => AgentResult | Promise<AgentResult>, dir: string): HarnessInstalado {
  const singleton = harnessPorNome(nome)
  const runOriginal = singleton.run.bind(singleton)
  const sintetico = harnessSintetico(singleton, `sintetico-${nome}`, resolver)
  const opcoes: OpcoesDoCassete = { nome: `tui-com-modelo-${nome}`, dir, modo: 'gravar-se-faltar' }
  const envolvido = envolverComCassete(sintetico, opcoes)
  singleton.run = (req: AgentRequest): Promise<AgentResult> => envolvido.run(req)
  return {
    restaurar: (): void => { singleton.run = runOriginal },
    caminhoDoCassete: join(dir, `${opcoes.nome}.json`),
  }
}

export interface ArquivoDeCasseteLido {
  formatoVersao: number
  entradas: EntradaDoCassete[]
}

export function lerCassete(caminho: string): ArquivoDeCasseteLido {
  return JSON.parse(readFileSync(caminho, 'utf8')) as ArquivoDeCasseteLido
}

export interface FakeTerminal extends Terminal {
  saida: string[]
  tecla: (k: string) => void
}

export function fakeTerminal(rows: number, cols: number): FakeTerminal {
  const saida: string[] = []
  let onKeyFn: ((k: string) => void) | null = null
  return {
    saida,
    write: (s: string): void => { saida.push(s) },
    rows: () => rows,
    cols: () => cols,
    onResize: () => {},
    offResize: () => {},
    onKey: (fn: (k: string) => void): void => { onKeyFn = fn },
    offKey: () => { onKeyFn = null },
    setRaw: () => {},
    tecla: (k: string): void => { onKeyFn?.(k) },
  }
}
