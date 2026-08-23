#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderProgress } from '../motor/euc/rdr/progresso'
import { initHicodeHome } from '../motor/cdl/ali/home'
import { installPrePush, uninstallPrePush } from '../motor/cdl/ali/hooks'
import { runSync } from '../motor/tmd/pnt/tarefas/sync'
import { taskSyncName } from '../motor/tmd/pnt/tarefas/registro'
import { limparTmpAntigo, usoDeDisco } from '../motor/euc/estado-em-disco'
import { linhasDoDisco } from '../lib/core/render/disco'
import { snapshotDoMotor, revisaoDoEstado } from '../lib/core/estado-json'
import { executarAcao, criarTarefa } from '../lib/core/comandos-de-tarefa'
import type { AcaoDeTarefa } from '../lib/core/comandos-de-tarefa'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DAEMON = join(ROOT, 'scripts', 'runner-daemon.sh')
const args = process.argv.slice(2)
const cmd = args[0]

function daemon(sub: string): number {
  return spawnSync(DAEMON, [sub], { stdio: 'inherit' }).status ?? 1
}

function semBoard(): number {
  process.stderr.write('o board saiu do terminal — navegar cards e do painel web (hicode)\n')
  process.stderr.write('no terminal: hii (abre a TUI) para trabalhar, hii watch para acompanhar\n')
  return 2
}

function script(name: string, extra: string[]): number {
  return spawnSync('bun', [join(ROOT, 'scripts', 'setup', `${name}.mjs`), ...extra], { stdio: 'inherit', cwd: ROOT }).status ?? 1
}

function runnerBun(extra: string[]): number {
  return spawnSync('bun', [join(ROOT, 'runner.ts'), ...extra], { stdio: 'inherit', cwd: ROOT }).status ?? 1
}

function disco(extra: string[]): number {
  const limpar = extra.includes('--limpar')
  if (limpar) {
    const r = limparTmpAntigo(0)
    process.stdout.write(`transitorio limpo: ${r.removidos.length} item(ns), ${r.bytesLiberados} bytes liberados\n`)
  }
  const uso = usoDeDisco()
  process.stdout.write(`${linhasDoDisco(uso, { color: process.stdout.isTTY === true }).join('\n')}\n`)
  return uso.nivel === 'teto' ? 1 : 0
}

function valorDaFlag(extra: string[], flag: string): string {
  const i = extra.indexOf(flag)
  return i >= 0 ? (extra[i + 1] ?? '') : ''
}

function estado(extra: string[]): number {
  if (extra.includes('--revisao')) {
    process.stdout.write(`${revisaoDoEstado()}\n`)
    return 0
  }
  const snapshot = snapshotDoMotor({ repo: valorDaFlag(extra, '--repo') })
  const espacos = extra.includes('--compacto') ? 0 : 2
  process.stdout.write(`${JSON.stringify(snapshot, null, espacos)}\n`)
  return 0
}

function semIdDeTarefa(acao: string): number {
  process.stderr.write(`uso: hii ${acao} <id> [texto] [--json]\n`)
  return 2
}

function tarefa(acao: AcaoDeTarefa, extra: string[]): number {
  const argumentos = extra.filter(a => !a.startsWith('--'))
  const id = argumentos[0] ?? ''
  if (!id) return semIdDeTarefa(acao)
  const r = executarAcao(acao, id, argumentos.slice(1).join(' '))
  if (extra.includes('--json')) process.stdout.write(`${JSON.stringify(r)}\n`)
  else process.stdout.write(`${r.mensagem}\n`)
  return r.ok ? 0 : 1
}

function tarefaNova(extra: string[]): number {
  const repo = valorDaFlag(extra, '--repo')
  const texto = extra.filter(a => !a.startsWith('--') && a !== repo).join(' ')
  const r = criarTarefa(texto, repo)
  if (extra.includes('--json')) process.stdout.write(`${JSON.stringify(r)}\n`)
  else process.stdout.write(`${r.mensagem}\n`)
  return r.ok ? 0 : 1
}

function comandoDeTarefa(extra: string[]): number {
  const sub = extra[0] ?? ''
  if (sub === 'nova' || sub === 'new') return tarefaNova(extra.slice(1))
  process.stderr.write('uso: hii tarefa nova "<o que mudar>" --repo <owner/nome> [--json]\n')
  return 2
}

function usage(): void {
  process.stdout.write([
    'hii — motor de execucao autonoma',
    '',
    'Uso: hii                  abre a TUI (escrever card, aprovar, acompanhar)',
    '     hii start            sobe o daemon',
    '     hii disco [--limpar] uso de disco do estado (refs, tmp, urls, runs)',
    '     hii estado [--json]  snapshot do motor em JSON (para o painel); --revisao so o token',
    '     hii responder <id> <texto>   responde a pergunta aberta da tarefa',
    '     hii tarefa nova "<texto>" --repo <owner/nome>  cria a tarefa e enfileira',
    '',

    'O motor nunca faz merge: ele abre o PR e para.',
    '',
    'Motor (daemon):',
    '  start                    inicia o motor em background (daemon)',
    '  stop                     para o daemon',
    '  restart                  reinicia o daemon',
    '  run                      roda o motor em foreground (nao daemoniza)',
    '  once                     processa a fila uma vez e sai',
    '',
    'Acompanhamento:',
    '  status                   estado do daemon + progresso dos cards',
    '  watch                    progresso dos cards ao vivo (atualiza sozinho)',
    '  board, quadro            saiu do terminal — os cards se navegam pelo painel web',
    '',
    'Portas humanas do card:',
    '  tarefa nova "<t>" --repo <owner/nome> [--json]   cria a tarefa e ja enfileira',
    '  approve <id>             aprova a url entregue (URL -> URL_OK)',
    '  approve <id> --plan      aprova o plano e enfileira (READY -> EXECUTING)',
    '  reject <id> [o que]      rejeita; com motivo, pede correcao',
    '  halt <id> [motivo]       para o card',
    '',
    'Repo-alvo (deterministico, 0 token) — "project" e sinonimo de "repo":',
    '  repo add <owner/nome>    registra o alvo, valida o clone, provisiona .hii/',
    '  repo rm <owner/nome>     remove do registro (o clone local nao e tocado)',
    '  repo ls                  lista os alvos registrados e o estado do clone',
    '  contract [caminho]       redetecta o contrato do alvo (stack, comandos)',
    '  doctor                   confere gh, IA, daemon, push e contrato',
    '',
    'Arquivo de cards:',
    '  rm <id> [id...] --yes    apaga cards e limpa worktree, url e runs',
    '  archive [--dry-run|ls|restore <id>]',
    '  teclas [--corrigir]      diagnostica/ensina shift+enter no terminal',
    '',
    'Tarefas e integracao:',
    '  sync                     sincroniza tarefas externas (HICODE_TASK_SYNC)',
    '  init [caminho]           provisiona .hii/ num repo-alvo (default: diretorio atual)',
    '  hooks install [caminho]  instala o gate pre-push deterministico (default: atual)',
    '  hooks uninstall [caminho] remove o gate pre-push',
    '',
    'Ajuda:',
    '  --help, -h, ajuda        mostra esta ajuda',
    '',
    'Fluxo de um card: executar -> url (link vivo) -> aprovar -> polir -> PR.',
    'Merge e SEMPRE humano: o motor para em PR_OPEN e nunca da merge.',
    '',
  ].join('\n'))
}

function hooks(): number {
  const sub = args[1]
  const repo = args[2] || process.cwd()
  const source = join(ROOT, 'scripts', 'hooks', 'pre-push')
  if (sub === 'install') {
    const r = installPrePush(repo, source)
    if (!r.ok) {
      process.stderr.write(`falha ao instalar: ${r.motivo}\n`)
      return 1
    }
    process.stdout.write(`pre-push instalado: ${r.caminho}\n`)
    if (r.backup) process.stdout.write(`  o pre-push que ja existia foi guardado em ${r.backup}\n`)
    return 0
  }
  if (sub === 'uninstall') {
    const r = uninstallPrePush(repo, source)
    if (!r.ok) {
      process.stderr.write(`${r.motivo}\n`)
      return 1
    }
    process.stdout.write(`pre-push removido de ${repo}\n`)
    if (r.restaurado) process.stdout.write(`  o pre-push anterior foi restaurado em ${r.restaurado}\n`)
    return 0
  }
  process.stdout.write('uso: hii hooks <install|uninstall> [caminho]\n')
  return 1
}

async function main(): Promise<number> {
  switch (cmd) {
    case 'help':
    case 'ajuda':
    case '--help':
    case '-h':
      usage()
      return 0
    case 'start':
    case 'stop':
    case 'restart':
      return daemon(cmd)
    case 'status':
      daemon('status')
      process.stdout.write(`\n${renderProgress()}\n`)
      return 0
    case 'watch': {
      const draw = (): void => { process.stdout.write(`\x1b[2J\x1b[H${renderProgress()}\n`) }
      draw()
      setInterval(draw, 2000)
      return -1
    }
    case 'run':
      return runnerBun([])
    case 'once':
      return runnerBun(['--once'])
    case 'sync': {
      const r = await runSync()
      process.stdout.write(`sync (${taskSyncName()}): ${r.created} cards criados, ${r.pushed} espelhados de ${r.pulled} externos\n`)
      return 0
    }
    case 'init': {
      const target = args[1] || process.cwd()
      const created = initHicodeHome(target)
      process.stdout.write(created.length ? `.hii/ provisionado em ${target}:\n${created.map(c => `  + ${c}`).join('\n')}\n` : `.hii/ ja existe em ${target}\n`)
      return 0
    }
    case 'hooks':
      return hooks()
    case 'repo':
    case 'project':
      return script('repo', args.slice(1))
    case 'approve':
    case 'aprovar':
      return tarefa(args.includes('--plan') || args.includes('--plano') ? 'aprovar-plano' : 'aprovar-url', args.slice(1))
    case 'reject':
    case 'recusar':
      return tarefa('recusar', args.slice(1))
    case 'halt':
    case 'parar':
      return tarefa('parar', args.slice(1))
    case 'answer':
    case 'responder':
      return tarefa('responder', args.slice(1))
    case 'tarefa':
    case 'task':
      return comandoDeTarefa(args.slice(1))
    case 'estado':
    case 'state':
      return estado(args.slice(1))
    case 'contract':
      return script('contract', args.slice(1))
    case 'doctor':
      return script('doctor', args.slice(1))
    case 'teclas':
      return args[1] === '--corrigir'
        ? script('wt-shift-enter', args.slice(2))
        : script('teclas', args.slice(1))
    case 'rm':
    case 'apagar':
      return script('rm', args.slice(1))
    case 'archive':
      return script('archive', args.slice(1))
    case 'disco':
      return disco(args.slice(1))
    case 'board':
    case 'quadro':
      return semBoard()
    case undefined:
      return spawnSync('bun', [join(ROOT, 'bin', 'repl.ts')], { stdio: 'inherit', cwd: ROOT }).status ?? 0
    default:
      usage()
      return 1
  }
}

const code = await main()
if (code >= 0) process.exit(code)
