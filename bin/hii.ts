#!/usr/bin/env bun
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderProgress } from '../lib/runner/progress'
import { initHicodeHome } from '../lib/runner/hicode-home'
import { installPrePush, uninstallPrePush } from '../lib/runner/hooks'
import { runSync } from '../lib/tasks/sync'
import { taskSyncName } from '../lib/tasks/registry'

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

function usage(): void {
  process.stdout.write([
    'hii — motor de execucao autonoma',
    '',
    'Uso: hii                  abre a TUI (escrever card, aprovar, acompanhar)',
    '     hii start            sobe o daemon',
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
    '',
    'Portas humanas do card:',
    '  approve <id>             aprova a url entregue (URL -> URL_OK)',
    '  approve <id> --plan      aprova o plano e enfileira (READY -> EXECUTING)',
    '  reject <id> [o que]      rejeita; com motivo, pede correcao',
    '  halt <id> [motivo]       para o card',
    '',
    'Repo-alvo (deterministico, 0 token):',
    '  repo add <owner/nome>    registra o alvo, valida o clone, provisiona .hii/',
    '  repo rm|ls               remove do registro | lista alvos e clones',
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
    const dest = installPrePush(repo, source)
    process.stdout.write(dest ? `pre-push instalado: ${dest}\n` : `falha ao instalar (repo git valido? hook fonte existe?)\n`)
    return dest ? 0 : 1
  }
  if (sub === 'uninstall') {
    const ok = uninstallPrePush(repo)
    process.stdout.write(ok ? `pre-push removido de ${repo}\n` : `nenhum pre-push encontrado em ${repo}\n`)
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
      return script('repo', args.slice(1))
    case 'approve':
    case 'reject':
    case 'halt':
      return runnerBun([cmd, ...args.slice(1)])
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
